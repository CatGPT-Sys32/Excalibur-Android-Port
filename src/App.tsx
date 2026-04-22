import { App as AppPlugin } from "@capacitor/app";
import { Share } from "@capacitor/share";
import { SplashScreen } from "@capacitor/splash-screen";
import {
  CaptureUpdateAction,
  Excalidraw,
  MIME_TYPES,
  WelcomeScreen,
} from "@excalidraw/excalidraw";
import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { BackupCenterModal } from "./components/BackupCenterModal";
import { CanvasManagerModal } from "./components/CanvasManagerModal";
import { DrawMainMenu } from "./components/DrawMainMenu";
import { ExportCenterModal } from "./components/ExportCenterModal";
import { ImportAssistantModal } from "./components/ImportAssistantModal";
import { PageSettingsModal } from "./components/PageSettingsModal";
import { PageTemplateOverlay } from "./components/PageTemplateOverlay";
import { TemplatePickerModal } from "./components/TemplatePickerModal";
import { isNativePlatform } from "./lib/capacitor";
import type { ExportFormat } from "./lib/exports";
import type { ImportFile, ImportPlan } from "./lib/imports";
import {
  A4_PAGE_SIZE,
  DEFAULT_PAGE_SETTINGS,
  getPageTemplateOption,
  isA4MarginLocked,
  isPageTemplateEnabled,
  normalizePageSettings,
  type PageSettings,
  type PageViewport,
} from "./lib/pageSettings";
import { CANVAS_TEMPLATES, type CanvasTemplate } from "./lib/templates";

import {
  addIntentOpenListener,
  addStylusChangeListener,
  clearPendingOpenSafe,
  getPendingOpenSafe,
  getStylusSnapshotSafe,
  openStorageDirectorySafe,
  type NativeStylusSnapshot,
  type PendingOpenFile,
  type PendingOpenPayload,
} from "./lib/androidBridge";
import {
  DEFAULT_SETTINGS,
  deleteCustomTemplate,
  createBackupZip,
  deleteSavedScene,
  duplicateSavedScene,
  getSavedSceneThumbnail,
  listSavedScenesFromDevice,
  listCanvasVersions,
  listCustomTemplates,
  loadAppBootstrap,
  loadSceneFromBlobData,
  loadSceneFromPath,
  loadSceneFromSavedDeviceFile,
  makeSceneTitle,
  persistLibrary,
  persistSavedSceneThumbnail,
  persistSettings,
  renameSavedScene,
  renameCustomTemplate,
  restoreBackupZip,
  restoreCanvasVersion,
  saveCanvasVersion,
  saveBlobExport,
  saveCustomTemplate,
  saveImportedLibraryFile,
  saveImportedSceneFile,
  saveRecoverySnapshot,
  setSavedScenePinned,
  saveTextExport,
  sceneHasContent,
  serializeLibrary,
  serializeScene,
  suggestedFilename,
  writeAutosave,
  type CanvasVersionMeta,
  type CustomCanvasTemplate,
  type DrawSettings,
  type SavedSceneFile,
  type SavedExport,
  type ScenePayload,
  type SceneSnapshotMeta,
} from "./lib/persistence";
import {
  getCommonBounds,
  newImageElement,
  syncInvalidIndices,
} from "@excalidraw/element";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  DataURL,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItems,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawFreeDrawElement,
  ExcalidrawImageElement,
  OrderedExcalidrawElement,
  Theme,
} from "@excalidraw/excalidraw/element/types";

const AUTOSAVE_DEBOUNCE_MS = 700;
const SNAPSHOT_INTERVAL_MS = 3 * 60 * 1000;
const MAX_PENDING_OPEN_BYTES = 8 * 1024 * 1024;
const AUTOSAVE_WARNING_INTERVAL_MS = 30 * 1000;
const STRAIGHTEN_HOLD_MS = 240;
const STRAIGHTEN_MOVE_THRESHOLD = 5;
const STRAIGHTEN_MIN_SEGMENT = 12;
const A4_MARGIN_GUARD_EPSILON = 0.5;
const A4_MARGIN_TOAST_INTERVAL_MS = 1800;

type ScenePoint = {
  x: number;
  y: number;
};

type StraightenSession = {
  isActive: boolean;
  isLocked: boolean;
  elementId: string | null;
  anchor: ScenePoint | null;
  direction: ScenePoint | null;
  maxDistance: number;
  lastPointer: ScenePoint | null;
  holdTimer: number | null;
};

const EMPTY_STRAIGHTEN_SESSION: StraightenSession = {
  isActive: false,
  isLocked: false,
  elementId: null,
  anchor: null,
  direction: null,
  maxDistance: 0,
  lastPointer: null,
  holdTimer: null,
};

type ExportScenePayload = {
  elements: readonly OrderedExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
};

type AutosaveStatus = "idle" | "saving" | "saved" | "degraded" | "failed";

type AutosaveHealth = {
  status: AutosaveStatus;
  updatedAt: string | null;
  message?: string;
};

type FreeDrawSample = {
  x: number;
  y: number;
  pressure: number;
};

type FreeDrawLocalPoint = ExcalidrawFreeDrawElement["points"][number];

const A4_PAGE_LEFT = 0;
const A4_PAGE_RIGHT = A4_PAGE_SIZE.width;
const SEGMENT_CLIP_EPSILON = 0.0001;

const clampA4PageX = (x: number) =>
  Math.min(A4_PAGE_RIGHT, Math.max(A4_PAGE_LEFT, x));

const getFreeDrawPressure = (
  element: ExcalidrawFreeDrawElement,
  index: number,
) =>
  element.pressures[index] ??
  element.pressures[index - 1] ??
  element.pressures[index + 1] ??
  0.5;

const sampleFreeDrawAt = (
  start: FreeDrawSample,
  end: FreeDrawSample,
  t: number,
): FreeDrawSample => ({
  x: clampA4PageX(start.x + (end.x - start.x) * t),
  y: start.y + (end.y - start.y) * t,
  pressure: start.pressure + (end.pressure - start.pressure) * t,
});

const clipSegmentToA4PageWidth = (
  start: FreeDrawSample,
  end: FreeDrawSample,
) => {
  const deltaX = end.x - start.x;
  let startT = 0;
  let endT = 1;

  if (Math.abs(deltaX) < SEGMENT_CLIP_EPSILON) {
    if (start.x < A4_PAGE_LEFT || start.x > A4_PAGE_RIGHT) {
      return null;
    }
  } else {
    const leftT = (A4_PAGE_LEFT - start.x) / deltaX;
    const rightT = (A4_PAGE_RIGHT - start.x) / deltaX;
    startT = Math.max(startT, Math.min(leftT, rightT));
    endT = Math.min(endT, Math.max(leftT, rightT));

    if (startT - endT > SEGMENT_CLIP_EPSILON) {
      return null;
    }
  }

  return [sampleFreeDrawAt(start, end, startT), sampleFreeDrawAt(start, end, endT)];
};

const appendFreeDrawSample = (
  samples: FreeDrawSample[],
  nextSample: FreeDrawSample,
) => {
  const previousSample = samples[samples.length - 1];
  if (
    previousSample &&
    Math.abs(previousSample.x - nextSample.x) < SEGMENT_CLIP_EPSILON &&
    Math.abs(previousSample.y - nextSample.y) < SEGMENT_CLIP_EPSILON
  ) {
    return;
  }

  samples.push(nextSample);
};

const isFreeDrawInsideA4PageWidth = (
  element: ExcalidrawFreeDrawElement,
) =>
  element.points.every((point) => {
    const x = element.x + point[0];
    return (
      x >= A4_PAGE_LEFT - A4_MARGIN_GUARD_EPSILON &&
      x <= A4_PAGE_RIGHT + A4_MARGIN_GUARD_EPSILON
    );
  });

const clipFreeDrawToA4PageWidth = (
  element: ExcalidrawFreeDrawElement,
): ExcalidrawFreeDrawElement | null => {
  if (element.angle !== 0 || element.points.length === 0) {
    return null;
  }

  const samples = element.points.map((point, index) => ({
    x: element.x + point[0],
    y: element.y + point[1],
    pressure: getFreeDrawPressure(element, index),
  }));
  const clippedSamples: FreeDrawSample[] = [];

  if (samples.length === 1) {
    if (!isFreeDrawInsideA4PageWidth(element)) {
      return null;
    }
    clippedSamples.push({
      ...samples[0],
      x: clampA4PageX(samples[0].x),
    });
  }

  for (let index = 1; index < samples.length; index += 1) {
    const clippedSegment = clipSegmentToA4PageWidth(
      samples[index - 1],
      samples[index],
    );

    if (!clippedSegment) {
      continue;
    }

    appendFreeDrawSample(clippedSamples, clippedSegment[0]);
    appendFreeDrawSample(clippedSamples, clippedSegment[1]);
  }

  if (clippedSamples.length === 0) {
    return null;
  }

  const minX = Math.min(...clippedSamples.map((sample) => sample.x));
  const minY = Math.min(...clippedSamples.map((sample) => sample.y));
  const maxX = Math.max(...clippedSamples.map((sample) => sample.x));
  const maxY = Math.max(...clippedSamples.map((sample) => sample.y));
  const points = clippedSamples.map(
    (sample) => [sample.x - minX, sample.y - minY] as FreeDrawLocalPoint,
  );

  return {
    ...element,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points,
    pressures: element.simulatePressure
      ? []
      : clippedSamples.map((sample) => sample.pressure),
    updated: Date.now(),
    version: element.version + 1,
    versionNonce: Math.trunc(Math.random() * 2147483647),
  };
};

const isElementInsideA4PageWidth = (element: OrderedExcalidrawElement) => {
  if (element.isDeleted) {
    return true;
  }

  if (element.type === "freedraw") {
    return isFreeDrawInsideA4PageWidth(element as ExcalidrawFreeDrawElement);
  }

  const [minX, , maxX] = getCommonBounds([element as never]);
  return (
    minX >= -A4_MARGIN_GUARD_EPSILON &&
    maxX <= A4_PAGE_SIZE.width + A4_MARGIN_GUARD_EPSILON
  );
};

const buildAcceptedA4ElementMap = (
  elements: readonly OrderedExcalidrawElement[],
) => {
  const acceptedElements = new Map<string, OrderedExcalidrawElement>();

  for (const element of elements) {
    if (isElementInsideA4PageWidth(element)) {
      acceptedElements.set(element.id, element);
    }
  }

  return acceptedElements;
};

const getA4MarginGuardedElements = (
  elements: readonly OrderedExcalidrawElement[],
  acceptedElements: ReadonlyMap<string, OrderedExcalidrawElement>,
  options: { keepPendingFreeDraw: boolean },
) => {
  let changed = false;
  const nextElements: OrderedExcalidrawElement[] = [];

  for (const element of elements) {
    if (isElementInsideA4PageWidth(element)) {
      nextElements.push(element);
      continue;
    }

    if (options.keepPendingFreeDraw && element.type === "freedraw") {
      nextElements.push(element);
      continue;
    }

    changed = true;
    if (element.type === "freedraw") {
      const clippedElement = clipFreeDrawToA4PageWidth(
        element as ExcalidrawFreeDrawElement,
      );

      if (clippedElement) {
        nextElements.push(clippedElement as OrderedExcalidrawElement);
        continue;
      }
    }

    const acceptedElement = acceptedElements.get(element.id);
    if (acceptedElement && isElementInsideA4PageWidth(acceptedElement)) {
      nextElements.push(acceptedElement);
      continue;
    }
  }

  return changed ? nextElements : null;
};

const distanceBetweenPoints = (first: ScenePoint, second: ScenePoint) =>
  Math.hypot(second.x - first.x, second.y - first.y);

const asFreeDrawElement = (
  element: OrderedExcalidrawElement | undefined,
): ExcalidrawFreeDrawElement | null => {
  if (!element || element.isDeleted || element.type !== "freedraw") {
    return null;
  }

  return element as ExcalidrawFreeDrawElement;
};

const findLatestFreeDrawElement = (
  elements: readonly OrderedExcalidrawElement[],
) => {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const freeDrawElement = asFreeDrawElement(elements[index]);
    if (freeDrawElement) {
      return freeDrawElement;
    }
  }

  return null;
};

const toWorldPoint = (
  element: ExcalidrawFreeDrawElement,
  point: readonly [number, number],
): ScenePoint => ({
  x: element.x + point[0],
  y: element.y + point[1],
});

const createStraightenedFreeDrawElement = (
  element: ExcalidrawFreeDrawElement,
  anchor: ScenePoint,
  end: ScenePoint,
): ExcalidrawFreeDrawElement => {
  const minX = Math.min(anchor.x, end.x);
  const minY = Math.min(anchor.y, end.y);
  const startPoint = [anchor.x - minX, anchor.y - minY] as ExcalidrawFreeDrawElement["points"][number];
  const endPoint = [end.x - minX, end.y - minY] as ExcalidrawFreeDrawElement["points"][number];
  const firstPressure = element.pressures[0] ?? 0.5;
  const lastPressure = element.pressures[element.pressures.length - 1] ?? firstPressure;

  return {
    ...element,
    x: minX,
    y: minY,
    width: Math.abs(end.x - anchor.x),
    height: Math.abs(end.y - anchor.y),
    points: [startPoint, endPoint],
    pressures: [firstPressure, lastPressure],
    updated: Date.now(),
    version: element.version + 1,
    versionNonce: Math.trunc(Math.random() * 2147483647),
  };
};

const pendingOpenToBlob = (
  pendingOpen: Pick<PendingOpenPayload, "data" | "encoding" | "mimeType" | "name">,
  fallbackMimeType: string,
) => {
  const mimeType = pendingOpen.mimeType || fallbackMimeType;

  if (pendingOpen.encoding === "base64") {
    const estimatedBytes = Math.floor((pendingOpen.data.length * 3) / 4);
    if (estimatedBytes > MAX_PENDING_OPEN_BYTES) {
      throw new Error("Incoming file exceeds size limit");
    }

    const bytes = Uint8Array.from(atob(pendingOpen.data), (char) =>
      char.charCodeAt(0),
    );
    return new Blob([bytes], { type: mimeType });
  }

  if (new TextEncoder().encode(pendingOpen.data).byteLength > MAX_PENDING_OPEN_BYTES) {
    throw new Error("Incoming file exceeds size limit");
  }

  return new Blob([pendingOpen.data], { type: mimeType });
};

const createScenePayload = (api: ExcalidrawImperativeAPI): ScenePayload => ({
  elements: api
    .getSceneElementsIncludingDeleted() as readonly OrderedExcalidrawElement[],
  appState: api.getAppState(),
  files: api.getFiles(),
});

const createExportPayload = (
  api: ExcalidrawImperativeAPI,
): ExportScenePayload => ({
  elements: api.getSceneElements() as readonly OrderedExcalidrawElement[],
  appState: api.getAppState(),
  files: api.getFiles(),
});

const shareSavedExport = async (savedExport: SavedExport, title: string) => {
  if (!savedExport.uri) {
    return;
  }

  await Share.share({
    title,
    dialogTitle: title,
    url: savedExport.uri,
  });
};

const blobToDataUrl = async (blob: Blob) =>
  new Promise<DataURL>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not load image data"));
        return;
      }
      resolve(reader.result as DataURL);
    };
    reader.readAsDataURL(blob);
  });

const loadImageDimensions = async (dataUrl: DataURL) =>
  new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || 640,
        height: image.naturalHeight || 480,
      });
    };
    image.onerror = () => resolve({ width: 640, height: 480 });
    image.src = dataUrl;
  });

const isLibraryImport = (file: Pick<ImportFile, "name" | "mimeType">) => {
  const name = file.name.toLowerCase();
  const mimeType = file.mimeType.toLowerCase();
  return name.endsWith(".excalidrawlib") || mimeType.includes("excalidrawlib");
};

const isImageImport = (file: Pick<ImportFile, "name" | "mimeType">) => {
  const name = file.name.toLowerCase();
  const mimeType = file.mimeType.toLowerCase();
  return (
    mimeType.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name)
  );
};

const isSceneImport = (file: Pick<ImportFile, "name" | "mimeType">) => {
  const name = file.name.toLowerCase();
  const mimeType = file.mimeType.toLowerCase();
  return (
    !isLibraryImport(file) &&
    !isImageImport(file) &&
    (name.endsWith(".excalidraw") ||
      name.endsWith(".json") ||
      mimeType.includes("json"))
  );
};

const createImportPlan = (importFiles: readonly ImportFile[]): ImportPlan =>
  importFiles.reduce<ImportPlan>(
    (plan, file) => {
      if (file.size > MAX_PENDING_OPEN_BYTES) {
        plan.oversized.push(file);
        return plan;
      }

      if (isLibraryImport(file)) {
        plan.libraries.push(file);
      } else if (isImageImport(file)) {
        plan.images.push(file);
      } else if (isSceneImport(file)) {
        plan.scenes.push(file);
      } else {
        plan.unsupported.push(file);
      }

      return plan;
    },
    {
      scenes: [],
      libraries: [],
      images: [],
      unsupported: [],
      oversized: [],
    },
  );

const supportedImportCount = (plan: ImportPlan) =>
  plan.scenes.length + plan.libraries.length + plan.images.length;

const estimatePendingOpenSize = (file: PendingOpenFile) => {
  if (typeof file.size === "number") {
    return file.size;
  }

  return file.encoding === "base64"
    ? Math.floor((file.data.length * 3) / 4)
    : new TextEncoder().encode(file.data).byteLength;
};

const pendingOpenFileToImportFile = (file: PendingOpenFile): ImportFile => {
  const fallbackMimeType = isLibraryImport(file)
    ? MIME_TYPES.excalidrawlib
    : isImageImport(file)
    ? file.mimeType || MIME_TYPES.binary
    : MIME_TYPES.excalidraw;
  const estimatedSize = estimatePendingOpenSize(file);

  if (estimatedSize > MAX_PENDING_OPEN_BYTES) {
    return {
      name: file.name,
      mimeType: file.mimeType || fallbackMimeType,
      blob: new Blob([], { type: file.mimeType || fallbackMimeType }),
      size: estimatedSize,
    };
  }

  const blob = pendingOpenToBlob(file, fallbackMimeType);
  return {
    name: file.name,
    mimeType: file.mimeType || fallbackMimeType,
    blob,
    size: file.size ?? blob.size,
  };
};

const pendingOpenFiles = (pendingOpen: PendingOpenPayload) =>
  pendingOpen.files?.length ? pendingOpen.files : [pendingOpen];

const shouldDeferPendingOpen = (pendingOpen: PendingOpenPayload | null) => {
  if (!pendingOpen) {
    return false;
  }

  const files = pendingOpenFiles(pendingOpen);
  return files.length > 1 || files.some((file) => isImageImport(file));
};

const makeElementId = () =>
  `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const formatExportTimestamp = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(
    date.getDate(),
  )}-${pad(date.getHours())}${pad(date.getMinutes())}`;
};

const formatAutosaveStatus = (status: AutosaveStatus) =>
  status[0].toUpperCase() + status.slice(1);

function App() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(
    null,
  );
  const [bootstrapped, setBootstrapped] = useState(false);
  const [bootstrapNotice, setBootstrapNotice] = useState<string | null>(null);
  const [libraryItems, setLibraryItems] = useState<LibraryItems>([]);
  const [recents, setRecents] = useState<SceneSnapshotMeta[]>([]);
  const [settings, setSettings] = useState<DrawSettings>(DEFAULT_SETTINGS);
  const [sceneName, setSceneName] = useState("Untitled scene");
  const [theme, setTheme] = useState<Theme>("light");
  const [lastAutosavedAt, setLastAutosavedAt] = useState<string | null>(null);
  const [autosaveHealth, setAutosaveHealth] = useState<AutosaveHealth>({
    status: "idle",
    updatedAt: null,
  });
  const [penMode, setPenMode] = useState(false);
  const [penDetected, setPenDetected] = useState(false);
  const [nativeStylus, setNativeStylus] = useState<NativeStylusSnapshot | null>(
    null,
  );
  const [zenModeEnabled, setZenModeEnabled] = useState(false);
  const [viewModeEnabled, setViewModeEnabled] = useState(false);
  const [gridModeEnabled, setGridModeEnabled] = useState(false);
  const [objectsSnapModeEnabled, setObjectsSnapModeEnabled] = useState(false);
  const [pageSettings, setPageSettings] =
    useState<PageSettings>(DEFAULT_PAGE_SETTINGS);
  const [pageViewport, setPageViewport] = useState<PageViewport | null>(null);
  const [canvasDirectoryOpen, setCanvasDirectoryOpen] = useState(false);
  const [canvasDirectoryLoading, setCanvasDirectoryLoading] = useState(false);
  const [savedCanvasFiles, setSavedCanvasFiles] = useState<SavedSceneFile[]>([]);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<CustomCanvasTemplate[]>(
    [],
  );
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);
  const [backupCenterOpen, setBackupCenterOpen] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [importAssistantPlan, setImportAssistantPlan] =
    useState<ImportPlan | null>(null);
  const [importAssistantBusy, setImportAssistantBusy] = useState(false);
  const [exportCenterOpen, setExportCenterOpen] = useState(false);
  const [exportCenterBusy, setExportCenterBusy] = useState(false);
  const [activeTimelineScene, setActiveTimelineScene] =
    useState<SavedSceneFile | null>(null);
  const [canvasVersions, setCanvasVersions] = useState<CanvasVersionMeta[]>([]);
  const [canvasVersionsLoading, setCanvasVersionsLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const latestSceneRef = useRef<ScenePayload | null>(null);
  const currentSavedSceneRef = useRef<SavedSceneFile | null>(null);
  const deferredPendingOpenRef = useRef<PendingOpenPayload | null>(null);
  const refreshSavedScenesRef = useRef<(() => Promise<void>) | null>(null);
  const recentsRef = useRef<SceneSnapshotMeta[]>([]);
  const settingsRef = useRef<DrawSettings>(DEFAULT_SETTINGS);
  const pageSettingsRef = useRef<PageSettings>(DEFAULT_PAGE_SETTINGS);
  const pageViewportRef = useRef<PageViewport | null>(null);
  const libraryItemsRef = useRef<LibraryItems>([]);
  const autosaveTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const lastAutosaveWarningAtRef = useRef(0);
  const a4MarginGuardTimerRef = useRef<number | null>(null);
  const hasMeaningfulChangeRef = useRef(false);
  const acceptedA4ElementsRef = useRef<Map<string, OrderedExcalidrawElement>>(
    new Map(),
  );
  const suppressA4MarginGuardRef = useRef(false);
  const lastA4MarginToastAtRef = useRef(0);
  const straightenSessionRef = useRef<StraightenSession>({
    ...EMPTY_STRAIGHTEN_SESSION,
  });
  const suppressStraightenPassRef = useRef(false);
  const lastSnapshotAtRef = useRef(0);
  const lastSnapshotSignatureRef = useRef("");
  const forcedEraserToolRef = useRef<AppState["activeTool"] | null>(null);

  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  useEffect(() => {
    recentsRef.current = recents;
  }, [recents]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    pageSettingsRef.current = pageSettings;
  }, [pageSettings]);

  useEffect(() => {
    libraryItemsRef.current = libraryItems;
  }, [libraryItems]);

  useEffect(() => {
    document.documentElement.dataset.appTheme = theme;
    document.title = `${makeSceneTitle(sceneName)} · Escalidraw`;
  }, [sceneName, theme]);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    apiRef.current?.setToast({
      message,
      duration: Infinity,
    });

    toastTimerRef.current = window.setTimeout(() => {
      apiRef.current?.setToast(null);
      toastTimerRef.current = null;
    }, 10000);
  }, []);

  const showThrottledAutosaveWarning = useCallback(
    (message: string) => {
      const now = Date.now();
      if (now - lastAutosaveWarningAtRef.current < AUTOSAVE_WARNING_INTERVAL_MS) {
        return;
      }

      lastAutosaveWarningAtRef.current = now;
      showToast(message);
    },
    [showToast],
  );

  const showA4MarginLockedToast = useCallback(() => {
    const now = Date.now();
    if (now - lastA4MarginToastAtRef.current < A4_MARGIN_TOAST_INTERVAL_MS) {
      return;
    }

    lastA4MarginToastAtRef.current = now;
    showToast("A4 margins are locked");
  }, [showToast]);

  const resetStraightenSession = useCallback(() => {
    const currentSession = straightenSessionRef.current;
    if (currentSession.holdTimer) {
      window.clearTimeout(currentSession.holdTimer);
    }

    straightenSessionRef.current = {
      ...EMPTY_STRAIGHTEN_SESSION,
    };
  }, []);

  const scheduleStraightenCheck = useCallback(() => {
    const session = straightenSessionRef.current;
    if (!session.isActive || session.isLocked) {
      return;
    }

    if (session.holdTimer) {
      window.clearTimeout(session.holdTimer);
    }

    session.holdTimer = window.setTimeout(() => {
      const liveSession = straightenSessionRef.current;
      const payload = latestSceneRef.current;
      const currentApi = apiRef.current;

      if (!liveSession.isActive || liveSession.isLocked || !liveSession.elementId) {
        return;
      }

      if (!payload || !currentApi) {
        return;
      }

      const activeElement = asFreeDrawElement(
        payload.elements.find((element) => element.id === liveSession.elementId),
      );

      if (!activeElement || activeElement.points.length < 2) {
        return;
      }

      const anchor = toWorldPoint(activeElement, activeElement.points[0]);
      const rawEnd = toWorldPoint(
        activeElement,
        activeElement.points[activeElement.points.length - 1],
      );

      const deltaX = rawEnd.x - anchor.x;
      const deltaY = rawEnd.y - anchor.y;
      const distance = Math.hypot(deltaX, deltaY);

      if (distance < STRAIGHTEN_MIN_SEGMENT) {
        return;
      }

      liveSession.isLocked = true;
      liveSession.anchor = anchor;
      liveSession.direction = {
        x: deltaX / distance,
        y: deltaY / distance,
      };
      liveSession.maxDistance = distance;

      const nextElement = createStraightenedFreeDrawElement(
        activeElement,
        anchor,
        rawEnd,
      );

      suppressStraightenPassRef.current = true;
      currentApi.updateScene({
        elements: payload.elements.map((element) =>
          element.id === activeElement.id
            ? (nextElement as OrderedExcalidrawElement)
            : element,
        ),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }, STRAIGHTEN_HOLD_MS);
  }, []);

  const persistCurrentScene = useCallback(
    async (forceSnapshot: boolean) => {
      const currentApi = apiRef.current;
      const payload = currentApi
        ? createScenePayload(currentApi)
        : latestSceneRef.current;

      if (!payload) {
        return false;
      }

      setAutosaveHealth({
        status: "saving",
        updatedAt: new Date().toISOString(),
      });
      let serialized = serializeScene(payload, pageSettingsRef.current);

      try {
        await writeAutosave(serialized);
        const savedAt = new Date().toISOString();
        setLastAutosavedAt(savedAt);
        setAutosaveHealth({
          status: "saved",
          updatedAt: savedAt,
        });
      } catch {
        try {
          // Compact fallback keeps autosave available when file payloads are too large.
          serialized = serializeScene(
            {
              ...payload,
              files: {} as BinaryFiles,
            },
            pageSettingsRef.current,
          );
          await writeAutosave(serialized);
          const savedAt = new Date().toISOString();
          const message =
            "Autosave is degraded. Embedded files/images may need manual save/export.";
          setLastAutosavedAt(savedAt);
          setAutosaveHealth({
            status: "degraded",
            updatedAt: savedAt,
            message,
          });
          showThrottledAutosaveWarning(message);
        } catch {
          const message = "Autosave failed. Use Save to device or Export Center.";
          setAutosaveHealth({
            status: "failed",
            updatedAt: new Date().toISOString(),
            message,
          });
          showThrottledAutosaveWarning(message);
          return false;
        }
      }

      if (!sceneHasContent(payload)) {
        return true;
      }

      const shouldSnapshot =
        lastSnapshotSignatureRef.current !== serialized &&
        (forceSnapshot ||
          Date.now() - lastSnapshotAtRef.current > SNAPSHOT_INTERVAL_MS);

      if (!shouldSnapshot) {
        return true;
      }

      try {
        const nextRecents = await saveRecoverySnapshot({
          serializedScene: serialized,
          title: makeSceneTitle(payload.appState.name),
          elementCount: payload.elements.filter((element) => !element.isDeleted)
            .length,
          recents: recentsRef.current,
        });

        lastSnapshotAtRef.current = Date.now();
        lastSnapshotSignatureRef.current = serialized;
        recentsRef.current = nextRecents;
        startTransition(() => setRecents(nextRecents));
      } catch {
        showToast("Recovery snapshot failed");
      }

      return true;
    },
    [showThrottledAutosaveWarning, showToast],
  );

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void persistCurrentScene(false);
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [persistCurrentScene]);

  const handleLibraryChange = useCallback((nextLibraryItems: LibraryItems) => {
    setLibraryItems(nextLibraryItems);
    libraryItemsRef.current = nextLibraryItems;
    void persistLibrary(nextLibraryItems);
  }, []);

  const applySceneData = useCallback(
    async (sceneData: ExcalidrawInitialDataState, notice?: string) => {
      const currentApi = apiRef.current;
      if (!currentApi) {
        return;
      }

      const nextPageSettings = normalizePageSettings(
        (sceneData as ExcalidrawInitialDataState & { pageSettings?: PageSettings })
          .pageSettings,
      );
      const nextElements =
        (sceneData.elements as readonly OrderedExcalidrawElement[] | undefined) ??
        [];
      setPageSettings(nextPageSettings);
      pageSettingsRef.current = nextPageSettings;
      acceptedA4ElementsRef.current = buildAcceptedA4ElementMap(nextElements);
      currentApi.history.clear();

      if (sceneData.libraryItems) {
        const nextLibraryItems = sceneData.libraryItems as LibraryItems;
        setLibraryItems(nextLibraryItems);
        libraryItemsRef.current = nextLibraryItems;
        await persistLibrary(nextLibraryItems);
        await Promise.resolve(
          currentApi.updateLibrary({ libraryItems: nextLibraryItems }),
        );
      }

      const files = Object.values(sceneData.files ?? {});
      if (files.length > 0) {
        currentApi.addFiles(files);
      }

      currentApi.updateScene({
        elements: nextElements,
        appState: {
          ...currentApi.getAppState(),
          ...(sceneData.appState ?? {}),
          openDialog: null,
          openSidebar: null,
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      if ((sceneData.elements?.length ?? 0) > 0) {
        currentApi.scrollToContent(sceneData.elements as never, {
          fitToContent: true,
          animate: false,
        });
      }

      await persistCurrentScene(true);

      if (notice) {
        showToast(notice);
      }
    },
    [persistCurrentScene, showToast],
  );

  const stageCurrentSceneForImport = useCallback(async () => {
    const payload = latestSceneRef.current;
    if (!payload || !sceneHasContent(payload)) {
      return;
    }

    if (currentSavedSceneRef.current && hasMeaningfulChangeRef.current) {
      const serializedScene = serializeScene(payload, pageSettingsRef.current);
      await saveCanvasVersion(
        currentSavedSceneRef.current,
        serializedScene,
        `Before leaving ${currentSavedSceneRef.current.name}`,
        payload.elements.filter((element) => !element.isDeleted).length,
      ).catch(() => undefined);
    }

    await persistCurrentScene(true);
  }, [persistCurrentScene]);

  const insertImageFiles = useCallback(
    async (imageFiles: readonly ImportFile[]) => {
      const currentApi = apiRef.current;
      if (!currentApi || imageFiles.length === 0) {
        return 0;
      }

      const currentState = currentApi.getAppState();
      const zoom = currentState.zoom?.value || 1;
      const viewportCenter = {
        x: -currentState.scrollX + currentState.width / (2 * zoom),
        y: -currentState.scrollY + currentState.height / (2 * zoom),
      };
      const imageElements: ExcalidrawImageElement[] = [];
      const binaryFiles: BinaryFileData[] = [];

      for (const [index, file] of imageFiles.entries()) {
        const dataURL = await blobToDataUrl(file.blob);
        const dimensions = await loadImageDimensions(dataURL);
        const scale = Math.min(1, 640 / Math.max(dimensions.width, dimensions.height));
        const width = Math.max(1, Math.round(dimensions.width * scale));
        const height = Math.max(1, Math.round(dimensions.height * scale));
        const fileId = makeElementId() as BinaryFileData["id"];
        const offset = index * 28;

        binaryFiles.push({
          id: fileId,
          mimeType: (file.mimeType || MIME_TYPES.binary) as BinaryFileData["mimeType"],
          dataURL,
          created: Date.now(),
          lastRetrieved: Date.now(),
        });

        imageElements.push(
          newImageElement({
            type: "image",
            x: viewportCenter.x - width / 2 + offset,
            y: viewportCenter.y - height / 2 + offset,
            width,
            height,
            fileId,
            status: "saved",
          }),
        );
      }

      currentApi.addFiles(binaryFiles);
      currentApi.updateScene({
        elements: syncInvalidIndices([
          ...currentApi.getSceneElementsIncludingDeleted(),
          ...imageElements,
        ]),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      await persistCurrentScene(true);
      return imageElements.length;
    },
    [persistCurrentScene],
  );

  const executeImportPlan = useCallback(
    async (plan: ImportPlan) => {
      const currentApi = apiRef.current;
      if (!currentApi || supportedImportCount(plan) === 0) {
        showToast("No supported files found");
        return;
      }

      await stageCurrentSceneForImport();

      if (
        plan.scenes.length === 1 &&
        plan.libraries.length === 0 &&
        plan.images.length === 0
      ) {
        const scene = await loadSceneFromBlobData(
          plan.scenes[0].blob,
          libraryItemsRef.current,
        );

        currentSavedSceneRef.current = null;
        await applySceneData(
          {
            ...scene,
            libraryItems: libraryItemsRef.current,
          },
          `Opened ${plan.scenes[0].name}`,
        );
        return;
      }

      let copiedScenes = 0;
      let mergedLibraries = 0;
      let insertedImages = 0;

      for (const sceneFile of plan.scenes) {
        await saveImportedSceneFile(sceneFile.name, await sceneFile.blob.text());
        copiedScenes += 1;
      }

      for (const libraryFile of plan.libraries) {
        const nextLibraryItems = (await currentApi.updateLibrary({
          libraryItems: libraryFile.blob,
          merge: true,
          prompt: false,
        })) as LibraryItems;

        setLibraryItems(nextLibraryItems);
        libraryItemsRef.current = nextLibraryItems;
        await persistLibrary(nextLibraryItems);
        await saveImportedLibraryFile(libraryFile.name, await libraryFile.blob.text());
        mergedLibraries += 1;
      }

      insertedImages = await insertImageFiles(plan.images);

      const summary = [
        copiedScenes ? `${copiedScenes} canvas file${copiedScenes === 1 ? "" : "s"}` : "",
        mergedLibraries
          ? `${mergedLibraries} librar${mergedLibraries === 1 ? "y" : "ies"}`
          : "",
        insertedImages ? `${insertedImages} image${insertedImages === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      const skipped = plan.unsupported.length + plan.oversized.length;

      if (summary.length) {
        showToast(
          `Imported ${summary.join(", ")}${
            skipped ? `; skipped ${skipped}` : ""
          }`,
        );
        await refreshSavedScenesRef.current?.();
      } else {
        showToast("No supported files found");
      }
    },
    [
      applySceneData,
      insertImageFiles,
      showToast,
      stageCurrentSceneForImport,
    ],
  );

  const processImportFiles = useCallback(
    async (importFiles: readonly ImportFile[]) => {
      if (!apiRef.current || importFiles.length === 0) {
        return;
      }

      const plan = createImportPlan(importFiles);
      const isSingleDirectScene =
        importFiles.length === 1 &&
        plan.scenes.length === 1 &&
        plan.libraries.length === 0 &&
        plan.images.length === 0 &&
        plan.unsupported.length === 0 &&
        plan.oversized.length === 0;

      if (isSingleDirectScene) {
        await executeImportPlan(plan);
        return;
      }

      setImportAssistantPlan(plan);
    },
    [executeImportPlan],
  );

  const handlePendingOpen = useCallback(
    async (pendingOpen: PendingOpenPayload) => {
      const currentApi = apiRef.current;
      if (!currentApi) {
        return;
      }

      try {
        const importFiles = pendingOpenFiles(pendingOpen).map(
          pendingOpenFileToImportFile,
        );
        await processImportFiles(importFiles);
      } catch {
        showToast(`Could not open ${pendingOpen.name}`);
      }
    },
    [processImportFiles, showToast],
  );

  const applyStylusSnapshot = useCallback((snapshot: NativeStylusSnapshot | null) => {
    setNativeStylus(snapshot);

    const currentApi = apiRef.current;
    if (!snapshot || !currentApi || !settingsRef.current.preferNativeStylusBridge) {
      return;
    }

    const currentState = currentApi.getAppState();

    if (
      !currentState.penDetected &&
      (snapshot.pointerType === "pen" || snapshot.toolType === "stylus")
    ) {
      currentApi.updateScene({
        appState: {
          penDetected: true,
          penMode: true,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }

    if (snapshot.toolType === "eraser") {
      if (!forcedEraserToolRef.current && currentState.activeTool.type !== "eraser") {
        forcedEraserToolRef.current = currentState.activeTool;
        currentApi.setActiveTool({ type: "eraser" });
      }
      return;
    }

    if (forcedEraserToolRef.current) {
      currentApi.setActiveTool(forcedEraserToolRef.current);
      forcedEraserToolRef.current = null;
    }
  }, []);

  const updatePenMode = useCallback(async (nextPenMode: boolean) => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    const currentState = currentApi.getAppState();

    currentApi.updateScene({
      appState: {
        penMode: nextPenMode,
        penDetected: nextPenMode || currentState.penDetected,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });

    const nextSettings = {
      ...settingsRef.current,
      forcePenMode: nextPenMode,
    };

    setSettings(nextSettings);
    settingsRef.current = nextSettings;
    await persistSettings(nextSettings);
  }, []);

  const updateStylusBridgePreference = useCallback(async (enabled: boolean) => {
    const nextSettings = {
      ...settingsRef.current,
      preferNativeStylusBridge: enabled,
    };

    setSettings(nextSettings);
    settingsRef.current = nextSettings;
    await persistSettings(nextSettings);
  }, []);

  const toggleTheme = useCallback(() => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    const nextTheme: Theme = theme === "dark" ? "light" : "dark";

    currentApi.updateScene({
      appState: {
        theme: nextTheme,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });

    setTheme(nextTheme);
  }, [theme]);

  const toggleZenMode = useCallback(() => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    const nextValue = !zenModeEnabled;
    currentApi.updateScene({
      appState: {
        zenModeEnabled: nextValue,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    setZenModeEnabled(nextValue);
  }, [zenModeEnabled]);

  const toggleViewMode = useCallback(() => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    const nextValue = !viewModeEnabled;
    currentApi.updateScene({
      appState: {
        viewModeEnabled: nextValue,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    setViewModeEnabled(nextValue);
  }, [viewModeEnabled]);

  const toggleGridMode = useCallback(() => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    const nextValue = !gridModeEnabled;
    currentApi.updateScene({
      appState: {
        gridModeEnabled: nextValue,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    setGridModeEnabled(nextValue);
  }, [gridModeEnabled]);

  const toggleSnapMode = useCallback(() => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    const nextValue = !objectsSnapModeEnabled;
    currentApi.updateScene({
      appState: {
        objectsSnapModeEnabled: nextValue,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    setObjectsSnapModeEnabled(nextValue);
  }, [objectsSnapModeEnabled]);

  const syncPageViewportFromAppState = useCallback((appState: AppState) => {
    if (!isPageTemplateEnabled(pageSettingsRef.current)) {
      if (pageViewportRef.current) {
        pageViewportRef.current = null;
        setPageViewport(null);
      }
      return;
    }

    const nextViewport: PageViewport = {
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      width: appState.width,
      height: appState.height,
      zoom: appState.zoom?.value || 1,
    };
    const currentViewport = pageViewportRef.current;

    if (
      currentViewport &&
      currentViewport.scrollX === nextViewport.scrollX &&
      currentViewport.scrollY === nextViewport.scrollY &&
      currentViewport.width === nextViewport.width &&
      currentViewport.height === nextViewport.height &&
      currentViewport.zoom === nextViewport.zoom
    ) {
      return;
    }

    pageViewportRef.current = nextViewport;
    setPageViewport(nextViewport);
  }, []);

  const applyA4MarginGuard = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      payload?: { appState: AppState; files: BinaryFiles },
      options: { keepPendingFreeDraw?: boolean } = {},
    ) => {
      const guardedElements = getA4MarginGuardedElements(
        elements,
        acceptedA4ElementsRef.current,
        { keepPendingFreeDraw: options.keepPendingFreeDraw ?? false },
      );

      if (!guardedElements) {
        acceptedA4ElementsRef.current = buildAcceptedA4ElementMap(elements);
        return false;
      }

      acceptedA4ElementsRef.current =
        buildAcceptedA4ElementMap(guardedElements);
      suppressA4MarginGuardRef.current = true;

      if (payload) {
        latestSceneRef.current = {
          elements: guardedElements,
          appState: payload.appState,
          files: payload.files,
        };
      }

      apiRef.current?.updateScene({
        elements: guardedElements,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      showA4MarginLockedToast();
      return true;
    },
    [showA4MarginLockedToast],
  );

  const handlePointerUpdate = useCallback(
    (payload: {
      pointer: { x: number; y: number; tool: "pointer" | "laser" };
      button: "down" | "up";
    }) => {
      const session = straightenSessionRef.current;
      if (!session.isActive || session.isLocked || payload.button !== "down") {
        return;
      }

      const nextPointer = {
        x: payload.pointer.x,
        y: payload.pointer.y,
      };

      if (
        !session.lastPointer ||
        distanceBetweenPoints(session.lastPointer, nextPointer) >=
          STRAIGHTEN_MOVE_THRESHOLD
      ) {
        session.lastPointer = nextPointer;
        scheduleStraightenCheck();
      }
    },
    [scheduleStraightenCheck],
  );

  const handleChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      setSceneName(makeSceneTitle(appState.name));
      setTheme(appState.theme);
      setPenMode(appState.penMode);
      setPenDetected(appState.penDetected);
      setZenModeEnabled(appState.zenModeEnabled);
      setViewModeEnabled(appState.viewModeEnabled);
      setGridModeEnabled(appState.gridModeEnabled);
      setObjectsSnapModeEnabled(appState.objectsSnapModeEnabled);
      syncPageViewportFromAppState(appState);

      if (suppressA4MarginGuardRef.current) {
        suppressA4MarginGuardRef.current = false;
        acceptedA4ElementsRef.current = buildAcceptedA4ElementMap(elements);
      } else if (isA4MarginLocked(pageSettingsRef.current)) {
        const guarded = applyA4MarginGuard(
          elements,
          { appState, files },
          { keepPendingFreeDraw: true },
        );
        if (guarded) {
          return;
        }
      } else {
        acceptedA4ElementsRef.current = buildAcceptedA4ElementMap(elements);
      }

      latestSceneRef.current = {
        elements,
        appState,
        files,
      };

      if (suppressStraightenPassRef.current) {
        suppressStraightenPassRef.current = false;
      } else {
        const session = straightenSessionRef.current;
        if (session.isActive) {
          const activeElement = session.elementId
            ? asFreeDrawElement(
                elements.find((element) => element.id === session.elementId),
              )
            : findLatestFreeDrawElement(elements);

          if (activeElement) {
            session.elementId = activeElement.id;

            if (
              session.isLocked &&
              session.anchor &&
              session.direction &&
              activeElement.points.length > 0
            ) {
              const rawEnd = toWorldPoint(
                activeElement,
                activeElement.points[activeElement.points.length - 1],
              );
              const projectedDistance =
                (rawEnd.x - session.anchor.x) * session.direction.x +
                (rawEnd.y - session.anchor.y) * session.direction.y;

              session.maxDistance = Math.max(
                session.maxDistance,
                projectedDistance,
                STRAIGHTEN_MIN_SEGMENT,
              );

              const straightEnd: ScenePoint = {
                x: session.anchor.x + session.direction.x * session.maxDistance,
                y: session.anchor.y + session.direction.y * session.maxDistance,
              };

              const currentEnd = toWorldPoint(
                activeElement,
                activeElement.points[activeElement.points.length - 1],
              );

              if (
                activeElement.points.length !== 2 ||
                distanceBetweenPoints(currentEnd, straightEnd) > 0.75
              ) {
                const nextElement = createStraightenedFreeDrawElement(
                  activeElement,
                  session.anchor,
                  straightEnd,
                );

                suppressStraightenPassRef.current = true;
                apiRef.current?.updateScene({
                  elements: elements.map((element) =>
                    element.id === activeElement.id
                      ? (nextElement as OrderedExcalidrawElement)
                      : element,
                  ),
                  captureUpdate: CaptureUpdateAction.NEVER,
                });
              }
            }
          }
        }
      }

      const hasMeaningfulScene =
        elements.some((element) => !element.isDeleted) ||
        Object.keys(files).length > 0 ||
        Boolean(appState.name?.trim());

      if (hasMeaningfulScene) {
        hasMeaningfulChangeRef.current = true;
      }

      if (!hasMeaningfulChangeRef.current) {
        return;
      }

      scheduleAutosave();
    },
    [applyA4MarginGuard, scheduleAutosave, syncPageViewportFromAppState],
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const pendingOpen = await getPendingOpenSafe();
        const deferPendingOpen = shouldDeferPendingOpen(pendingOpen);
        if (deferPendingOpen) {
          deferredPendingOpenRef.current = pendingOpen;
        }

        const nextBootstrap = await loadAppBootstrap(
          deferPendingOpen ? null : pendingOpen,
        );
        await clearPendingOpenSafe();

        if (cancelled) {
          return;
        }

        setInitialData(nextBootstrap.initialData);
        setLibraryItems(nextBootstrap.libraryItems);
        setCustomTemplates(nextBootstrap.customTemplates);
        setRecents(nextBootstrap.recents);
        setSettings(nextBootstrap.settings);
        setPageSettings(nextBootstrap.pageSettings);
        setBootstrapNotice(nextBootstrap.importNotice ?? null);
        libraryItemsRef.current = nextBootstrap.libraryItems;
        recentsRef.current = nextBootstrap.recents;
        settingsRef.current = nextBootstrap.settings;
        pageSettingsRef.current = nextBootstrap.pageSettings;
        acceptedA4ElementsRef.current = buildAcceptedA4ElementMap(
          (nextBootstrap.initialData?.elements as
            | readonly OrderedExcalidrawElement[]
            | undefined) ?? [],
        );
        setBootstrapped(true);
      } catch {
        if (cancelled) {
          return;
        }

        const safeInitialData: ExcalidrawInitialDataState = {
          appState: { showWelcomeScreen: true },
          libraryItems: [],
        };
        setInitialData(safeInitialData);
        setLibraryItems([]);
        setCustomTemplates([]);
        setRecents([]);
        setSettings(DEFAULT_SETTINGS);
        setPageSettings(DEFAULT_PAGE_SETTINGS);
        setBootstrapNotice("Startup recovery used a blank canvas.");
        libraryItemsRef.current = [];
        recentsRef.current = [];
        settingsRef.current = DEFAULT_SETTINGS;
        pageSettingsRef.current = DEFAULT_PAGE_SETTINGS;
        acceptedA4ElementsRef.current = new Map();
        setBootstrapped(true);
      } finally {
        if (!cancelled) {
          await SplashScreen.hide().catch(() => undefined);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!api || !bootstrapNotice) {
      return;
    }

    showToast(bootstrapNotice);
    setBootstrapNotice(null);
  }, [api, bootstrapNotice, showToast]);

  useEffect(() => {
    if (!api || !bootstrapped || !deferredPendingOpenRef.current) {
      return;
    }

    const pendingOpen = deferredPendingOpenRef.current;
    deferredPendingOpenRef.current = null;
    void handlePendingOpen(pendingOpen);
  }, [api, bootstrapped, handlePendingOpen]);

  useEffect(() => {
    if (!bootstrapped || !api || !initialData) {
      return;
    }

    if (settings.forcePenMode) {
      api.updateScene({
        appState: {
          penMode: true,
          penDetected: true,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
  }, [api, bootstrapped, initialData, settings.forcePenMode]);

  useEffect(() => {
    if (!bootstrapped) {
      return;
    }

    void getStylusSnapshotSafe().then((snapshot) => {
      if (snapshot) {
        applyStylusSnapshot(snapshot);
      }
    });
  }, [applyStylusSnapshot, bootstrapped]);

  useEffect(() => {
    if (!bootstrapped) {
      return;
    }

    let disposed = false;

    const register = async () => {
      const intentListener = await addIntentOpenListener((pendingOpen) => {
        if (!disposed) {
          void handlePendingOpen(pendingOpen);
        }
      });
      const stylusListener = await addStylusChangeListener((snapshot) => {
        if (!disposed) {
          applyStylusSnapshot(snapshot);
        }
      });

      return () => {
        void intentListener.remove();
        void stylusListener.remove();
      };
    };

    let cleanup: () => void = () => {};

    void register().then((teardown) => {
      cleanup = teardown;
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [applyStylusSnapshot, bootstrapped, handlePendingOpen]);

  useEffect(() => {
    if (!api) {
      return;
    }

    const unsubscribePointerDown = api.onPointerDown(
      (activeTool, pointerDownState) => {
        if (activeTool.type !== "freedraw") {
          resetStraightenSession();
          return;
        }

        resetStraightenSession();
        straightenSessionRef.current = {
          ...EMPTY_STRAIGHTEN_SESSION,
          isActive: true,
          lastPointer: {
            x: pointerDownState.origin.x,
            y: pointerDownState.origin.y,
          },
        };

        scheduleStraightenCheck();
      },
    );

    const unsubscribePointerUp = api.onPointerUp(() => {
      if (a4MarginGuardTimerRef.current) {
        window.clearTimeout(a4MarginGuardTimerRef.current);
      }

      if (isA4MarginLocked(pageSettingsRef.current)) {
        a4MarginGuardTimerRef.current = window.setTimeout(() => {
          a4MarginGuardTimerRef.current = null;
          const currentApi = apiRef.current ?? api;
          if (!currentApi || !isA4MarginLocked(pageSettingsRef.current)) {
            return;
          }

          const payload = createScenePayload(currentApi);
          applyA4MarginGuard(
            payload.elements,
            { appState: payload.appState, files: payload.files },
            { keepPendingFreeDraw: false },
          );
        }, 0);
      }
      resetStraightenSession();
    });

    return () => {
      unsubscribePointerDown();
      unsubscribePointerUp();
      if (a4MarginGuardTimerRef.current) {
        window.clearTimeout(a4MarginGuardTimerRef.current);
        a4MarginGuardTimerRef.current = null;
      }
      resetStraightenSession();
    };
  }, [api, applyA4MarginGuard, resetStraightenSession, scheduleStraightenCheck]);

  useEffect(() => {
    const listenerPromise = AppPlugin.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        void persistCurrentScene(true);
      }
    });

    return () => {
      void listenerPromise.then((listener) => listener.remove());
    };
  }, [persistCurrentScene]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (a4MarginGuardTimerRef.current) {
        window.clearTimeout(a4MarginGuardTimerRef.current);
      }
    };
  }, []);

  const openFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const openDirectory = useCallback(async () => {
    if (!isNativePlatform) {
      openFiles();
      return;
    }

    const result = await openStorageDirectorySafe();
    if (result.opened) {
      return;
    }

    const reason = result.error?.trim();
    showToast(
      reason
        ? `Could not open Excalidraw directory: ${reason}`
        : "Could not open Excalidraw directory",
    );
  }, [openFiles, showToast]);

  const hydrateSavedSceneThumbnails = useCallback(
    async (savedScenes: SavedSceneFile[]) => {
      const { exportToBlob } = await import("@excalidraw/excalidraw");

      for (const savedScene of savedScenes) {
        try {
          const cachedThumbnail = await getSavedSceneThumbnail(savedScene);
          if (cachedThumbnail) {
            setSavedCanvasFiles((currentFiles) =>
              currentFiles.map((currentFile) =>
                currentFile.path === savedScene.path &&
                currentFile.location === savedScene.location
                  ? { ...currentFile, thumbnailUri: cachedThumbnail }
                  : currentFile,
              ),
            );
            continue;
          }

          const scene = await loadSceneFromSavedDeviceFile(savedScene, []);
          const elements = (
            (scene.elements as readonly OrderedExcalidrawElement[] | undefined) ??
            []
          ).filter((element) => !element.isDeleted);

          if (elements.length === 0) {
            continue;
          }

          const blob = await exportToBlob({
            elements: elements as never,
            appState: scene.appState,
            files: (scene.files ?? {}) as BinaryFiles,
            maxWidthOrHeight: 220,
            exportPadding: 12,
            mimeType: MIME_TYPES.png,
          });
          const thumbnailUri = await blobToDataUrl(blob);
          await persistSavedSceneThumbnail(savedScene, thumbnailUri);
          setSavedCanvasFiles((currentFiles) =>
            currentFiles.map((currentFile) =>
              currentFile.path === savedScene.path &&
              currentFile.location === savedScene.location
                ? {
                    ...currentFile,
                    thumbnailUri,
                    elementCount: elements.length,
                  }
                : currentFile,
            ),
          );
        } catch {
          // Thumbnail generation is best-effort and should not block the manager.
        }
      }
    },
    [],
  );

  const refreshSavedScenes = useCallback(async () => {
    setCanvasDirectoryLoading(true);

    try {
      const savedScenes = await listSavedScenesFromDevice();
      setSavedCanvasFiles(savedScenes);
      void hydrateSavedSceneThumbnails(savedScenes);
    } catch {
      setSavedCanvasFiles([]);
      showToast("Could not open Excalidraw/canvases");
    } finally {
      setCanvasDirectoryLoading(false);
    }
  }, [hydrateSavedSceneThumbnails, showToast]);

  refreshSavedScenesRef.current = refreshSavedScenes;

  const openCanvas = useCallback(async () => {
    setCanvasDirectoryOpen(true);
    setActiveTimelineScene(null);
    setCanvasVersions([]);
    await refreshSavedScenes();
  }, [refreshSavedScenes]);

  const openSavedCanvas = useCallback(
    async (savedScene: SavedSceneFile) => {
      try {
        await stageCurrentSceneForImport();

        const scene = await loadSceneFromSavedDeviceFile(
          savedScene,
          libraryItemsRef.current,
        );

        await applySceneData(
          {
            ...scene,
            libraryItems: libraryItemsRef.current,
          },
          `Opened ${savedScene.name}`,
        );

        currentSavedSceneRef.current = savedScene;
        hasMeaningfulChangeRef.current = false;
        setCanvasDirectoryOpen(false);
        setActiveTimelineScene(null);
      } catch {
        showToast(`Could not open ${savedScene.name}`);
      }
    },
    [applySceneData, showToast, stageCurrentSceneForImport],
  );

  const onLocalFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files ?? []);
      event.target.value = "";

      if (selectedFiles.length === 0 || !apiRef.current) {
        return;
      }

      try {
        await processImportFiles(
          selectedFiles.map((file) => ({
            name: file.name,
            mimeType: file.type,
            blob: file,
            size: file.size,
          })),
        );
      } catch {
        showToast("Could not import selected files");
      }
    },
    [processImportFiles, showToast],
  );

  const saveSceneCopy = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    try {
      const payload = createScenePayload(currentApi);
      const defaultFilename = suggestedFilename(
        makeSceneTitle(payload.appState.name),
        ".excalidraw",
      );
      const requestedFilename =
        typeof window.prompt === "function"
          ? window.prompt("Save to device as:", defaultFilename)
          : defaultFilename;

      if (requestedFilename === null) {
        showToast("Save canceled");
        return;
      }

      const filenameSource = requestedFilename.trim() || defaultFilename;
      const savedExport = await saveTextExport(
        suggestedFilename(filenameSource, ".excalidraw"),
        serializeScene(payload, pageSettingsRef.current),
        MIME_TYPES.excalidraw,
      );

      if (!savedExport.downloaded) {
        const savedScenes = await listSavedScenesFromDevice().catch(() => []);
        currentSavedSceneRef.current =
          savedScenes.find((savedScene) => savedScene.path === savedExport.path) ??
          savedScenes.find((savedScene) => savedScene.name === savedExport.filename) ??
          null;
        if (canvasDirectoryOpen) {
          setSavedCanvasFiles(savedScenes);
          void hydrateSavedSceneThumbnails(savedScenes);
        }
      }

      showToast(
        savedExport.downloaded
          ? `Downloaded ${savedExport.filename}`
          : `Saved to ${savedExport.path}`,
      );
    } catch (error) {
      const reason =
        error instanceof Error && error.message ? ` (${error.message})` : "";
      showToast(`Could not save this scene${reason}`);
    }
  }, [canvasDirectoryOpen, hydrateSavedSceneThumbnails, showToast]);

  const shareSceneCopy = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    try {
      const payload = createScenePayload(currentApi);
      const savedExport = await saveTextExport(
        suggestedFilename(makeSceneTitle(payload.appState.name), ".excalidraw"),
        serializeScene(payload, pageSettingsRef.current),
        MIME_TYPES.excalidraw,
      );

      if (!savedExport.uri) {
        showToast(`Downloaded ${savedExport.filename}`);
        return;
      }

      await shareSavedExport(savedExport, "Share Escalidraw scene");
    } catch {
      showToast("Could not prepare scene for sharing");
    }
  }, [showToast]);

  const exportLibrary = useCallback(async () => {
    try {
      const savedExport = await saveTextExport(
        suggestedFilename(`${makeSceneTitle(sceneName)}-library`, ".excalidrawlib"),
        serializeLibrary(libraryItemsRef.current),
        MIME_TYPES.excalidrawlib,
      );

      showToast(
        savedExport.downloaded
          ? `Downloaded ${savedExport.filename}`
          : `Saved to ${savedExport.path}`,
      );
    } catch {
      showToast("Could not export the library");
    }
  }, [sceneName, showToast]);

  const exportPng = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");

      const exportPayload = createExportPayload(currentApi);
      const blob = await exportToBlob({
        elements: exportPayload.elements,
        appState: exportPayload.appState,
        files: exportPayload.files,
        mimeType: MIME_TYPES.png,
      });

      const savedExport = await saveBlobExport(
        suggestedFilename(makeSceneTitle(exportPayload.appState.name), ".png"),
        blob,
      );

      showToast(
        savedExport.downloaded
          ? `Downloaded ${savedExport.filename}`
          : `Saved to ${savedExport.path}`,
      );
    } catch {
      showToast("Could not export PNG");
    }
  }, [showToast]);

  const exportSvg = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    try {
      const { exportToSvg } = await import("@excalidraw/excalidraw");

      const exportPayload = createExportPayload(currentApi);
      const svgElement = await exportToSvg({
        elements: exportPayload.elements,
        appState: exportPayload.appState,
        files: exportPayload.files,
      });

      const savedExport = await saveBlobExport(
        suggestedFilename(makeSceneTitle(exportPayload.appState.name), ".svg"),
        new Blob([svgElement.outerHTML], { type: MIME_TYPES.svg }),
      );

      showToast(
        savedExport.downloaded
          ? `Downloaded ${savedExport.filename}`
          : `Saved to ${savedExport.path}`,
      );
    } catch {
      showToast("Could not export SVG");
    }
  }, [showToast]);

  const exportPdf = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    try {
      const { createA4PdfBlob } = await import("./lib/pdfExport");
      const exportPayload = createExportPayload(currentApi);
      const blob = await createA4PdfBlob(exportPayload, pageSettingsRef.current);
      const savedExport = await saveBlobExport(
        suggestedFilename(
          `${makeSceneTitle(exportPayload.appState.name)}-${formatExportTimestamp(
            new Date(),
          )}`,
          ".pdf",
        ),
        blob,
      );

      showToast(
        savedExport.downloaded
          ? `Downloaded ${savedExport.filename}`
          : `Saved to ${savedExport.path}`,
      );
    } catch {
      showToast("Could not export PDF");
    }
  }, [showToast]);

  const exportSelectedFormats = useCallback(
    async (formats: readonly ExportFormat[]) => {
      const currentApi = apiRef.current;
      if (!currentApi || formats.length === 0) {
        return;
      }

      setExportCenterBusy(true);
      try {
        const exportPayload = createExportPayload(currentApi);
        const title = makeSceneTitle(exportPayload.appState.name);
        const timestamp = formatExportTimestamp(new Date());
        let exportedCount = 0;
        let failedCount = 0;

        for (const format of formats) {
          try {
            if (format === "excalidraw") {
              await saveTextExport(
                suggestedFilename(`${title}-${timestamp}`, ".excalidraw"),
                serializeScene(createScenePayload(currentApi), pageSettingsRef.current),
                MIME_TYPES.excalidraw,
                { forceExports: true },
              );
              exportedCount += 1;
              continue;
            }

            if (format === "png") {
              const { exportToBlob } = await import("@excalidraw/excalidraw");
              const blob = await exportToBlob({
                elements: exportPayload.elements,
                appState: exportPayload.appState,
                files: exportPayload.files,
                mimeType: MIME_TYPES.png,
              });
              await saveBlobExport(
                suggestedFilename(`${title}-${timestamp}`, ".png"),
                blob,
              );
              exportedCount += 1;
              continue;
            }

            if (format === "svg") {
              const { exportToSvg } = await import("@excalidraw/excalidraw");
              const svgElement = await exportToSvg({
                elements: exportPayload.elements,
                appState: exportPayload.appState,
                files: exportPayload.files,
              });
              await saveBlobExport(
                suggestedFilename(`${title}-${timestamp}`, ".svg"),
                new Blob([svgElement.outerHTML], { type: MIME_TYPES.svg }),
              );
              exportedCount += 1;
              continue;
            }

            if (format === "pdf") {
              const { createA4PdfBlob } = await import("./lib/pdfExport");
              const blob = await createA4PdfBlob(
                exportPayload,
                pageSettingsRef.current,
              );
              await saveBlobExport(
                suggestedFilename(`${title}-${timestamp}`, ".pdf"),
                blob,
              );
              exportedCount += 1;
            }
          } catch {
            failedCount += 1;
          }
        }

        if (exportedCount === 0) {
          showToast("Export Center failed");
          return;
        }

        showToast(
          `Exported ${exportedCount} file${exportedCount === 1 ? "" : "s"}${
            failedCount ? `, ${failedCount} failed` : ""
          }`,
        );
        setExportCenterOpen(false);
      } finally {
        setExportCenterBusy(false);
      }
    },
    [showToast],
  );

  const restoreLatestAutosave = useCallback(async () => {
    const latestRecent = recentsRef.current[0];
    if (!latestRecent) {
      showToast("No recovery snapshots yet");
      return;
    }

    try {
      const scene = await loadSceneFromPath(
        latestRecent.path,
        libraryItemsRef.current,
      );
      await applySceneData(scene, `Restored ${latestRecent.title}`);
    } catch {
      showToast("Latest recovery snapshot is unavailable");
    }
  }, [applySceneData, showToast]);

  const refreshCustomTemplates = useCallback(async () => {
    try {
      setCustomTemplates(await listCustomTemplates());
    } catch {
      showToast("Could not load custom templates");
    }
  }, [showToast]);

  const saveCurrentAsTemplate = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    const payload = createScenePayload(currentApi);
    const defaultName = makeSceneTitle(payload.appState.name);
    const requestedName =
      typeof window.prompt === "function"
        ? window.prompt("Template name:", defaultName)
        : defaultName;

    if (requestedName === null) {
      showToast("Template save canceled");
      return;
    }

    const name = requestedName.trim() || defaultName;
    const requestedDescription =
      typeof window.prompt === "function"
        ? window.prompt("Template description:", "Custom canvas template")
        : "Custom canvas template";

    if (requestedDescription === null) {
      showToast("Template save canceled");
      return;
    }

    try {
      await saveCustomTemplate({
        name,
        description: requestedDescription,
        serializedScene: serializeScene(payload, pageSettingsRef.current),
      });
      await refreshCustomTemplates();
      showToast(`Saved template ${name}`);
    } catch {
      showToast("Could not save template");
    }
  }, [refreshCustomTemplates, showToast]);

  const renameTemplate = useCallback(
    async (template: CustomCanvasTemplate) => {
      const requestedName = window.prompt("Rename template:", template.name);
      if (requestedName === null) {
        return;
      }

      try {
        await renameCustomTemplate(template, requestedName);
        await refreshCustomTemplates();
        showToast("Template renamed");
      } catch {
        showToast(`Could not rename ${template.name}`);
      }
    },
    [refreshCustomTemplates, showToast],
  );

  const deleteTemplate = useCallback(
    async (template: CustomCanvasTemplate) => {
      if (!window.confirm(`Delete ${template.name}?`)) {
        return;
      }

      try {
        await deleteCustomTemplate(template);
        await refreshCustomTemplates();
        showToast(`Deleted ${template.name}`);
      } catch {
        showToast(`Could not delete ${template.name}`);
      }
    },
    [refreshCustomTemplates, showToast],
  );

  const applyTemplate = useCallback(
    async (template: CanvasTemplate | CustomCanvasTemplate) => {
      try {
        await stageCurrentSceneForImport();
        currentSavedSceneRef.current = null;
        await applySceneData(
          {
            ...template.initialData,
            appState: {
              ...template.initialData.appState,
              name: template.name,
            },
          },
          `Created ${template.name}`,
        );
        setTemplatePickerOpen(false);
      } catch {
        showToast(`Could not apply ${template.name}`);
      }
    },
    [applySceneData, showToast, stageCurrentSceneForImport],
  );

  const updatePageSettings = useCallback(
    (nextPageSettings: PageSettings) => {
      setPageSettings(nextPageSettings);
      pageSettingsRef.current = nextPageSettings;
      let guardedMargins = false;
      if (isPageTemplateEnabled(nextPageSettings)) {
        const appState = apiRef.current?.getAppState();
        if (appState) {
          syncPageViewportFromAppState(appState);
        }
      } else if (pageViewportRef.current) {
        pageViewportRef.current = null;
        setPageViewport(null);
      }
      if (isA4MarginLocked(nextPageSettings) && apiRef.current) {
        const payload = createScenePayload(apiRef.current);
        guardedMargins = applyA4MarginGuard(payload.elements, {
          appState: payload.appState,
          files: payload.files,
        });
      }
      hasMeaningfulChangeRef.current = true;
      scheduleAutosave();
      if (!guardedMargins) {
        showToast(
          `Page template: ${getPageTemplateOption(nextPageSettings.template).name}`,
        );
      }
    },
    [
      applyA4MarginGuard,
      scheduleAutosave,
      showToast,
      syncPageViewportFromAppState,
    ],
  );

  const renameCanvas = useCallback(
    async (savedScene: SavedSceneFile) => {
      const requestedName = window.prompt("Rename canvas:", savedScene.name);
      if (requestedName === null) {
        return;
      }

      try {
        const renamedScene = await renameSavedScene(savedScene, requestedName);
        if (
          currentSavedSceneRef.current?.path === savedScene.path &&
          currentSavedSceneRef.current.location === savedScene.location
        ) {
          currentSavedSceneRef.current = renamedScene;
        }
        showToast(`Renamed to ${renamedScene.name}`);
        await refreshSavedScenes();
      } catch (error) {
        const reason =
          error instanceof Error && error.message ? ` (${error.message})` : "";
        showToast(`Could not rename canvas${reason}`);
      }
    },
    [refreshSavedScenes, showToast],
  );

  const duplicateCanvas = useCallback(
    async (savedScene: SavedSceneFile) => {
      try {
        const duplicatedScene = await duplicateSavedScene(savedScene);
        showToast(`Duplicated ${duplicatedScene.name}`);
        await refreshSavedScenes();
      } catch {
        showToast(`Could not duplicate ${savedScene.name}`);
      }
    },
    [refreshSavedScenes, showToast],
  );

  const togglePinnedCanvas = useCallback(
    async (savedScene: SavedSceneFile) => {
      try {
        const pinned = await setSavedScenePinned(savedScene, !savedScene.pinned);
        setSavedCanvasFiles((currentFiles) =>
          currentFiles.map((currentFile) =>
            currentFile.path === savedScene.path &&
            currentFile.location === savedScene.location
              ? { ...currentFile, pinned }
              : currentFile,
          ),
        );
        showToast(
          pinned ? `Pinned ${savedScene.name}` : `Unpinned ${savedScene.name}`,
        );
      } catch {
        showToast(`Could not update ${savedScene.name}`);
      }
    },
    [showToast],
  );

  const deleteCanvas = useCallback(
    async (savedScene: SavedSceneFile) => {
      if (!window.confirm(`Delete ${savedScene.name}?`)) {
        return;
      }

      try {
        const deleteSummary = await deleteSavedScene(savedScene);
        if (
          currentSavedSceneRef.current?.path === savedScene.path &&
          currentSavedSceneRef.current.location === savedScene.location
        ) {
          currentSavedSceneRef.current = null;
        }
        setSavedCanvasFiles((currentFiles) =>
          currentFiles.filter((currentFile) => currentFile.name !== savedScene.name),
        );
        setActiveTimelineScene(null);
        setCanvasVersions([]);
        showToast(
          deleteSummary.deleted > 1
            ? `Deleted ${savedScene.name} (${deleteSummary.deleted} copies)`
            : `Deleted ${savedScene.name}`,
        );
        await refreshSavedScenes();
      } catch (error) {
        const reason =
          error instanceof Error && error.message ? ` (${error.message})` : "";
        showToast(`Could not delete ${savedScene.name}${reason}`);
      }
    },
    [refreshSavedScenes, showToast],
  );

  const openCanvasTimeline = useCallback(
    async (savedScene: SavedSceneFile) => {
      setActiveTimelineScene(savedScene);
      setCanvasVersions([]);
      setCanvasVersionsLoading(true);

      try {
        setCanvasVersions(await listCanvasVersions(savedScene));
      } catch {
        showToast(`Could not load timeline for ${savedScene.name}`);
      } finally {
        setCanvasVersionsLoading(false);
      }
    },
    [showToast],
  );

  const restoreCanvasFromTimeline = useCallback(
    async (savedScene: SavedSceneFile, version: CanvasVersionMeta) => {
      if (!window.confirm(`Restore ${savedScene.name} from this version?`)) {
        return;
      }

      try {
        const scene = await restoreCanvasVersion(
          savedScene,
          version.id,
          libraryItemsRef.current,
        );
        await applySceneData(scene, `Restored ${savedScene.name}`);
        currentSavedSceneRef.current = savedScene;
        await refreshSavedScenes();
        await openCanvasTimeline(savedScene);
      } catch {
        showToast(`Could not restore ${savedScene.name}`);
      }
    },
    [applySceneData, openCanvasTimeline, refreshSavedScenes, showToast],
  );

  const exportBackup = useCallback(async () => {
    setBackupBusy(true);
    try {
      const savedBackup = await createBackupZip();
      showToast(
        savedBackup.downloaded
          ? `Downloaded ${savedBackup.filename}`
          : `Saved to ${savedBackup.path}`,
      );
    } catch {
      showToast("Could not create backup");
    } finally {
      setBackupBusy(false);
    }
  }, [showToast]);

  const restoreBackup = useCallback(
    async (file: File) => {
      setBackupBusy(true);
      try {
        const summary = await restoreBackupZip(file);
        showToast(
          `Restored ${summary.restored} file${summary.restored === 1 ? "" : "s"}`,
        );
        await refreshSavedScenes();
      } catch (error) {
        const reason =
          error instanceof Error && error.message ? ` (${error.message})` : "";
        showToast(`Could not restore backup${reason}`);
      } finally {
        setBackupBusy(false);
      }
    },
    [refreshSavedScenes, showToast],
  );

  if (!bootstrapped || !initialData) {
    return (
      <div className="draw-loading-shell">
        <div className="draw-loading-card">
          <div className="draw-loading-mark" />
          <p className="draw-loading-kicker">Personal Android build</p>
          <h1>Escalidraw</h1>
          <p>
            Loading the official editor with offline assets, local autosave, and
            Android packaging.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="draw-app-shell">
      <input
        ref={fileInputRef}
        className="draw-hidden-input"
        type="file"
        accept=".excalidraw,.excalidrawlib,.json,application/json,image/*,*/*"
        multiple
        onChange={onLocalFileSelected}
      />

      {canvasDirectoryOpen ? (
        <CanvasManagerModal
          activeTimelineScene={activeTimelineScene}
          loading={canvasDirectoryLoading}
          savedScenes={savedCanvasFiles}
          versions={canvasVersions}
          versionsLoading={canvasVersionsLoading}
          onClose={() => setCanvasDirectoryOpen(false)}
          onDelete={(savedScene) => {
            void deleteCanvas(savedScene);
          }}
          onDuplicate={(savedScene) => {
            void duplicateCanvas(savedScene);
          }}
          onOpen={(savedScene) => {
            void openSavedCanvas(savedScene);
          }}
          onRefresh={() => {
            void refreshSavedScenes();
          }}
          onRename={(savedScene) => {
            void renameCanvas(savedScene);
          }}
          onRestoreVersion={(savedScene, version) => {
            void restoreCanvasFromTimeline(savedScene, version);
          }}
          onTimeline={(savedScene) => {
            void openCanvasTimeline(savedScene);
          }}
          onTogglePinned={(savedScene) => {
            void togglePinnedCanvas(savedScene);
          }}
        />
      ) : null}

      {templatePickerOpen ? (
        <TemplatePickerModal
          customTemplates={customTemplates}
          templates={CANVAS_TEMPLATES}
          onClose={() => setTemplatePickerOpen(false)}
          onDeleteCustom={(template) => {
            void deleteTemplate(template);
          }}
          onRenameCustom={(template) => {
            void renameTemplate(template);
          }}
          onSelect={(template) => {
            void applyTemplate(template);
          }}
        />
      ) : null}

      {pageSettingsOpen ? (
        <PageSettingsModal
          pageSettings={pageSettings}
          onClose={() => setPageSettingsOpen(false)}
          onChange={updatePageSettings}
        />
      ) : null}

      {backupCenterOpen ? (
        <BackupCenterModal
          busy={backupBusy}
          onClose={() => setBackupCenterOpen(false)}
          onExport={() => {
            void exportBackup();
          }}
          onRestore={(file) => {
            void restoreBackup(file);
          }}
        />
      ) : null}

      {importAssistantPlan ? (
        <ImportAssistantModal
          busy={importAssistantBusy}
          plan={importAssistantPlan}
          onClose={() => {
            if (!importAssistantBusy) {
              setImportAssistantPlan(null);
            }
          }}
          onConfirm={() => {
            const plan = importAssistantPlan;
            setImportAssistantBusy(true);
            void executeImportPlan(plan)
              .then(() => {
                setImportAssistantPlan(null);
              })
              .catch(() => {
                showToast("Could not import selected files");
              })
              .finally(() => {
                setImportAssistantBusy(false);
              });
          }}
        />
      ) : null}

      {exportCenterOpen ? (
        <ExportCenterModal
          busy={exportCenterBusy}
          onClose={() => {
            if (!exportCenterBusy) {
              setExportCenterOpen(false);
            }
          }}
          onExport={(formats) => {
            void exportSelectedFormats(formats);
          }}
        />
      ) : null}

      <PageTemplateOverlay pageSettings={pageSettings} viewport={pageViewport} />

      <Excalidraw
        initialData={initialData}
        onExcalidrawAPI={setApi}
        onChange={handleChange}
        onPointerUpdate={handlePointerUpdate}
        onLibraryChange={handleLibraryChange}
        autoFocus
        handleKeyboardGlobally
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            saveAsImage: false,
            export: false,
            clearCanvas: true,
            changeViewBackgroundColor: true,
            toggleTheme: true,
          },
          tools: {
            image: true,
          },
        }}
      >
        <WelcomeScreen />
        <DrawMainMenu
          autosaveMessage={autosaveHealth.message}
          autosaveStatus={formatAutosaveStatus(autosaveHealth.status)}
          exportLibrary={exportLibrary}
          exportPdf={exportPdf}
          exportPng={exportPng}
          exportSvg={exportSvg}
          gridModeEnabled={gridModeEnabled}
          lastAutosavedAt={lastAutosavedAt}
          nativeStylus={nativeStylus}
          objectsSnapModeEnabled={objectsSnapModeEnabled}
          openBackupCenter={() => setBackupCenterOpen(true)}
          openCanvas={openCanvas}
          openExportCenter={() => setExportCenterOpen(true)}
          openFiles={openFiles}
          openDirectory={openDirectory}
          openPageSettings={() => setPageSettingsOpen(true)}
          openTemplates={() => setTemplatePickerOpen(true)}
          pageSettings={pageSettings}
          penDetected={penDetected}
          penMode={penMode}
          recentsCount={recents.length}
          restoreLatestAutosave={restoreLatestAutosave}
          saveCurrentAsTemplate={saveCurrentAsTemplate}
          saveSceneCopy={saveSceneCopy}
          settings={settings}
          shareSceneCopy={shareSceneCopy}
          theme={theme}
          toggleGridMode={toggleGridMode}
          toggleSnapMode={toggleSnapMode}
          toggleTheme={toggleTheme}
          toggleViewMode={toggleViewMode}
          toggleZenMode={toggleZenMode}
          updatePenMode={updatePenMode}
          updateStylusBridgePreference={updateStylusBridgePreference}
          viewModeEnabled={viewModeEnabled}
          zenModeEnabled={zenModeEnabled}
        />
      </Excalidraw>
    </div>
  );
}

export default App;
