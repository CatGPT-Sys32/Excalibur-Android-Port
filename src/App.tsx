import { App as AppPlugin } from "@capacitor/app";
import { Share } from "@capacitor/share";
import { SplashScreen } from "@capacitor/splash-screen";
import {
  CaptureUpdateAction,
  Excalidraw,
  MIME_TYPES,
  MainMenu,
  WelcomeScreen,
  exportToBlob,
  exportToSvg,
  loadFromBlob,
  loadLibraryFromBlob,
} from "@excalidraw/excalidraw";
import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  addIntentOpenListener,
  addStylusChangeListener,
  clearPendingOpenSafe,
  getPendingOpenSafe,
  getStylusSnapshotSafe,
  type NativeStylusSnapshot,
  type PendingOpenPayload,
} from "./lib/androidBridge";
import {
  DEFAULT_SETTINGS,
  loadAppBootstrap,
  loadSceneFromPath,
  makeSceneTitle,
  persistLibrary,
  persistSettings,
  saveBlobExport,
  saveRecoverySnapshot,
  saveTextExport,
  sceneHasContent,
  serializeLibrary,
  serializeScene,
  suggestedFilename,
  writeAutosave,
  type DrawSettings,
  type SavedExport,
  type ScenePayload,
  type SceneSnapshotMeta,
} from "./lib/persistence";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItems,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawFreeDrawElement,
  OrderedExcalidrawElement,
  Theme,
} from "@excalidraw/excalidraw/element/types";

const AUTOSAVE_DEBOUNCE_MS = 700;
const SNAPSHOT_INTERVAL_MS = 3 * 60 * 1000;
const STRAIGHTEN_HOLD_MS = 240;
const STRAIGHTEN_MOVE_THRESHOLD = 5;
const STRAIGHTEN_MIN_SEGMENT = 12;

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
  const startPoint: [number, number] = [anchor.x - minX, anchor.y - minY];
  const endPoint: [number, number] = [end.x - minX, end.y - minY];
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
    lastCommittedPoint: endPoint,
    updated: Date.now(),
    version: element.version + 1,
    versionNonce: Math.trunc(Math.random() * 2147483647),
  };
};

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return "Not saved yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const pendingOpenToBlob = (pendingOpen: PendingOpenPayload, fallbackMimeType: string) => {
  const mimeType = pendingOpen.mimeType || fallbackMimeType;

  if (pendingOpen.encoding === "base64") {
    const bytes = Uint8Array.from(atob(pendingOpen.data), (char) =>
      char.charCodeAt(0),
    );
    return new Blob([bytes], { type: mimeType });
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

const onOffLabel = (enabled: boolean) => (enabled ? "On" : "Off");

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
  const [penMode, setPenMode] = useState(false);
  const [penDetected, setPenDetected] = useState(false);
  const [nativeStylus, setNativeStylus] = useState<NativeStylusSnapshot | null>(
    null,
  );
  const [zenModeEnabled, setZenModeEnabled] = useState(false);
  const [viewModeEnabled, setViewModeEnabled] = useState(false);
  const [gridModeEnabled, setGridModeEnabled] = useState(false);
  const [objectsSnapModeEnabled, setObjectsSnapModeEnabled] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const latestSceneRef = useRef<ScenePayload | null>(null);
  const recentsRef = useRef<SceneSnapshotMeta[]>([]);
  const settingsRef = useRef<DrawSettings>(DEFAULT_SETTINGS);
  const libraryItemsRef = useRef<LibraryItems>([]);
  const autosaveTimerRef = useRef<number | null>(null);
  const hasMeaningfulChangeRef = useRef(false);
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
    libraryItemsRef.current = libraryItems;
  }, [libraryItems]);

  useEffect(() => {
    document.documentElement.dataset.appTheme = theme;
    document.title = `${makeSceneTitle(sceneName)} · Escalidraw`;
  }, [sceneName, theme]);

  const showToast = useCallback((message: string) => {
    apiRef.current?.setToast({
      message,
      duration: 2600,
    });
  }, []);

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

      let serialized = serializeScene(payload);

      try {
        await writeAutosave(serialized);
        setLastAutosavedAt(new Date().toISOString());
      } catch {
        try {
          // Compact fallback keeps autosave available when file payloads are too large.
          serialized = serializeScene({
            ...payload,
            files: {} as BinaryFiles,
          });
          await writeAutosave(serialized);
          setLastAutosavedAt(new Date().toISOString());
        } catch {
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
    [showToast],
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
        elements:
          (sceneData.elements as readonly OrderedExcalidrawElement[] | undefined) ??
          [],
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
    if (!latestSceneRef.current || !sceneHasContent(latestSceneRef.current)) {
      return;
    }
    await persistCurrentScene(true);
  }, [persistCurrentScene]);

  const handlePendingOpen = useCallback(
    async (pendingOpen: PendingOpenPayload) => {
      const currentApi = apiRef.current;
      if (!currentApi) {
        return;
      }

      try {
        await stageCurrentSceneForImport();

        if (pendingOpen.name.endsWith(".excalidrawlib")) {
          const importedLibrary = (await loadLibraryFromBlob(
            pendingOpenToBlob(pendingOpen, MIME_TYPES.excalidrawlib),
          )) as LibraryItems;
          setLibraryItems(importedLibrary);
          libraryItemsRef.current = importedLibrary;
          await persistLibrary(importedLibrary);
          await Promise.resolve(
            currentApi.updateLibrary({ libraryItems: importedLibrary }),
          );
          showToast(`Imported library from ${pendingOpen.name}`);
          return;
        }

        const scene = await loadFromBlob(
          pendingOpenToBlob(pendingOpen, MIME_TYPES.excalidraw),
          currentApi.getAppState(),
          currentApi.getSceneElementsIncludingDeleted(),
        );

        await applySceneData(
          {
            ...scene,
            libraryItems: libraryItemsRef.current,
          },
          `Opened ${pendingOpen.name}`,
        );
      } catch {
        showToast(`Could not open ${pendingOpen.name}`);
      }
    },
    [applySceneData, showToast, stageCurrentSceneForImport],
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
      latestSceneRef.current = {
        elements,
        appState,
        files,
      };

      setSceneName(makeSceneTitle(appState.name));
      setTheme(appState.theme);
      setPenMode(appState.penMode);
      setPenDetected(appState.penDetected);
      setZenModeEnabled(appState.zenModeEnabled);
      setViewModeEnabled(appState.viewModeEnabled);
      setGridModeEnabled(appState.gridModeEnabled);
      setObjectsSnapModeEnabled(appState.objectsSnapModeEnabled);

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
    [scheduleAutosave],
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const pendingOpen = await getPendingOpenSafe();
      const nextBootstrap = await loadAppBootstrap(pendingOpen);
      await clearPendingOpenSafe();

      if (cancelled) {
        return;
      }

      setInitialData(nextBootstrap.initialData);
      setLibraryItems(nextBootstrap.libraryItems);
      setRecents(nextBootstrap.recents);
      setSettings(nextBootstrap.settings);
      setBootstrapNotice(nextBootstrap.importNotice ?? null);
      libraryItemsRef.current = nextBootstrap.libraryItems;
      recentsRef.current = nextBootstrap.recents;
      settingsRef.current = nextBootstrap.settings;
      setBootstrapped(true);
      await SplashScreen.hide().catch(() => undefined);
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
      resetStraightenSession();
    });

    return () => {
      unsubscribePointerDown();
      unsubscribePointerUp();
      resetStraightenSession();
    };
  }, [api, resetStraightenSession, scheduleStraightenCheck]);

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
    };
  }, []);

  const openLocalFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onLocalFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0];
      event.target.value = "";

      if (!selectedFile || !apiRef.current) {
        return;
      }

      try {
        await stageCurrentSceneForImport();

        if (selectedFile.name.endsWith(".excalidrawlib")) {
          const importedLibrary = (await loadLibraryFromBlob(
            selectedFile,
          )) as LibraryItems;
          setLibraryItems(importedLibrary);
          libraryItemsRef.current = importedLibrary;
          await persistLibrary(importedLibrary);
          await Promise.resolve(
            apiRef.current.updateLibrary({ libraryItems: importedLibrary }),
          );
          showToast(`Imported library from ${selectedFile.name}`);
          return;
        }

        const scene = await loadFromBlob(
          selectedFile,
          apiRef.current.getAppState(),
          apiRef.current.getSceneElementsIncludingDeleted(),
        );

        await applySceneData(
          {
            ...scene,
            libraryItems: libraryItemsRef.current,
          },
          `Opened ${selectedFile.name}`,
        );
      } catch {
        showToast(`Could not open ${selectedFile.name}`);
      }
    },
    [applySceneData, showToast, stageCurrentSceneForImport],
  );

  const saveSceneCopy = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    const payload = createScenePayload(currentApi);
    const savedExport = await saveTextExport(
      suggestedFilename(makeSceneTitle(payload.appState.name), ".excalidraw"),
      serializeScene(payload),
      MIME_TYPES.excalidraw,
    );

    showToast(
      savedExport.downloaded
        ? `Downloaded ${savedExport.filename}`
        : `Saved ${savedExport.filename}`,
    );
  }, [showToast]);

  const shareSceneCopy = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

    const payload = createScenePayload(currentApi);
    const savedExport = await saveTextExport(
      suggestedFilename(makeSceneTitle(payload.appState.name), ".excalidraw"),
      serializeScene(payload),
      MIME_TYPES.excalidraw,
    );

    if (!savedExport.uri) {
      showToast(`Downloaded ${savedExport.filename}`);
      return;
    }

    await shareSavedExport(savedExport, "Share Escalidraw scene");
  }, [showToast]);

  const exportLibrary = useCallback(async () => {
    const savedExport = await saveTextExport(
      suggestedFilename(`${makeSceneTitle(sceneName)}-library`, ".excalidrawlib"),
      serializeLibrary(libraryItemsRef.current),
      MIME_TYPES.excalidrawlib,
    );

    showToast(
      savedExport.downloaded
        ? `Downloaded ${savedExport.filename}`
        : `Saved ${savedExport.filename}`,
    );
  }, [sceneName, showToast]);

  const exportPng = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

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
        : `Saved ${savedExport.filename}`,
    );
  }, [showToast]);

  const exportSvg = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi) {
      return;
    }

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
        : `Saved ${savedExport.filename}`,
    );
  }, [showToast]);

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
        accept=".excalidraw,.excalidrawlib,application/json"
        onChange={onLocalFileSelected}
      />

      <Excalidraw
        initialData={initialData}
        excalidrawAPI={setApi}
        onChange={handleChange}
        onPointerUpdate={handlePointerUpdate}
        onLibraryChange={handleLibraryChange}
        autoFocus
        handleKeyboardGlobally
        UIOptions={{
          canvasActions: {
            loadScene: true,
            saveToActiveFile: true,
            saveAsImage: true,
            export: {
              saveFileToDisk: true,
            },
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
          exportLibrary={exportLibrary}
          exportPng={exportPng}
          exportSvg={exportSvg}
          gridModeEnabled={gridModeEnabled}
          lastAutosavedAt={lastAutosavedAt}
          nativeStylus={nativeStylus}
          objectsSnapModeEnabled={objectsSnapModeEnabled}
          openLocalFile={openLocalFile}
          penDetected={penDetected}
          penMode={penMode}
          recentsCount={recents.length}
          restoreLatestAutosave={restoreLatestAutosave}
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

type DrawMainMenuProps = {
  openLocalFile: () => void;
  saveSceneCopy: () => Promise<void>;
  shareSceneCopy: () => Promise<void>;
  exportLibrary: () => Promise<void>;
  exportPng: () => Promise<void>;
  exportSvg: () => Promise<void>;
  restoreLatestAutosave: () => Promise<void>;
  theme: Theme;
  penMode: boolean;
  penDetected: boolean;
  settings: DrawSettings;
  zenModeEnabled: boolean;
  viewModeEnabled: boolean;
  gridModeEnabled: boolean;
  objectsSnapModeEnabled: boolean;
  lastAutosavedAt: string | null;
  recentsCount: number;
  nativeStylus: NativeStylusSnapshot | null;
  toggleTheme: () => void;
  toggleZenMode: () => void;
  toggleViewMode: () => void;
  toggleGridMode: () => void;
  toggleSnapMode: () => void;
  updatePenMode: (nextPenMode: boolean) => Promise<void>;
  updateStylusBridgePreference: (enabled: boolean) => Promise<void>;
};

function DrawMainMenu(props: DrawMainMenuProps) {
  return (
    <MainMenu>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
      <MainMenu.DefaultItems.SaveAsImage />
      <MainMenu.DefaultItems.Export />
      <MainMenu.DefaultItems.CommandPalette />
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.Separator />
      <MainMenu.ItemCustom>
        <div className="draw-menu-section-title">File Actions</div>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className="draw-menu-button" type="button" onClick={props.openLocalFile}>
          <span className="draw-menu-button-label">Open `.excalidraw` / library file</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className="draw-menu-button" type="button" onClick={props.saveSceneCopy}>
          <span className="draw-menu-button-label">Save scene copy to device</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className="draw-menu-button" type="button" onClick={props.shareSceneCopy}>
          <span className="draw-menu-button-label">Share current scene</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className="draw-menu-button" type="button" onClick={props.exportPng}>
          <span className="draw-menu-button-label">Export PNG to device</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className="draw-menu-button" type="button" onClick={props.exportSvg}>
          <span className="draw-menu-button-label">Export SVG to device</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className="draw-menu-button" type="button" onClick={props.exportLibrary}>
          <span className="draw-menu-button-label">Export library</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button
          className="draw-menu-button"
          type="button"
          onClick={props.restoreLatestAutosave}
        >
          <span className="draw-menu-button-label">Restore latest recovery snapshot</span>
          <span className="draw-menu-button-meta">{props.recentsCount} saved</span>
        </button>
      </MainMenu.ItemCustom>

      <MainMenu.Separator />
      <MainMenu.ItemCustom>
        <div className="draw-menu-section-title">Options</div>
      </MainMenu.ItemCustom>

      <MainMenu.ItemCustom>
        <button className="draw-menu-button" type="button" onClick={props.toggleTheme}>
          <span className="draw-menu-button-label">Dark mode</span>
          <span className="draw-menu-badge">{onOffLabel(props.theme === "dark")}</span>
        </button>
      </MainMenu.ItemCustom>

      <MainMenu.ItemCustom>
        <button className="draw-menu-button" type="button" onClick={props.toggleZenMode}>
          <span className="draw-menu-button-label">Zen canvas mode</span>
          <span className="draw-menu-badge">{onOffLabel(props.zenModeEnabled)}</span>
        </button>
      </MainMenu.ItemCustom>

      <MainMenu.ItemCustom>
        <button className="draw-menu-button" type="button" onClick={props.toggleViewMode}>
          <span className="draw-menu-button-label">View-only mode</span>
          <span className="draw-menu-badge">{onOffLabel(props.viewModeEnabled)}</span>
        </button>
      </MainMenu.ItemCustom>

      <MainMenu.ItemCustom>
        <button className="draw-menu-button" type="button" onClick={props.toggleGridMode}>
          <span className="draw-menu-button-label">Grid overlay</span>
          <span className="draw-menu-badge">{onOffLabel(props.gridModeEnabled)}</span>
        </button>
      </MainMenu.ItemCustom>

      <MainMenu.ItemCustom>
        <button className="draw-menu-button" type="button" onClick={props.toggleSnapMode}>
          <span className="draw-menu-button-label">Object snap</span>
          <span className="draw-menu-badge">
            {onOffLabel(props.objectsSnapModeEnabled)}
          </span>
        </button>
      </MainMenu.ItemCustom>

      <MainMenu.ItemCustom>
        <button
          className="draw-menu-button"
          type="button"
          onClick={() => {
            void props.updatePenMode(!props.penMode);
          }}
        >
          <span className="draw-menu-button-label">Stylus mode</span>
          <span className="draw-menu-badge">{onOffLabel(props.penMode)}</span>
        </button>
      </MainMenu.ItemCustom>

      <MainMenu.ItemCustom>
        <button
          className="draw-menu-button"
          type="button"
          onClick={() => {
            void props.updateStylusBridgePreference(
              !props.settings.preferNativeStylusBridge,
            );
          }}
        >
          <span className="draw-menu-button-label">Native stylus bridge</span>
          <span className="draw-menu-badge">
            {onOffLabel(props.settings.preferNativeStylusBridge)}
          </span>
        </button>
      </MainMenu.ItemCustom>

      <MainMenu.ItemCustom>
        <div className="draw-menu-status-card">
          <div>
            <span>Last autosave</span>
            <strong>{formatTimestamp(props.lastAutosavedAt)}</strong>
          </div>
          <div>
            <span>Pen detected</span>
            <strong>{props.penDetected ? "Yes" : "No"}</strong>
          </div>
          <div>
            <span>Native tool</span>
            <strong>{props.nativeStylus?.toolType ?? "Unavailable"}</strong>
          </div>
        </div>
      </MainMenu.ItemCustom>

      <MainMenu.Separator />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.DefaultItems.Help />
    </MainMenu>
  );
}

export default App;
