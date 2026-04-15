import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import {
  MIME_TYPES,
  loadFromBlob,
  loadLibraryFromBlob,
  serializeAsJSON,
  serializeLibraryAsJSON,
} from "@excalidraw/excalidraw";

import { isNativePlatform } from "./capacitor";
import type { PendingOpenPayload } from "./androidBridge";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
  LibraryItems,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

const APP_PATHS = {
  autosave: "scenes/autosave.excalidraw",
  library: "library/default.excalidrawlib",
  recoveryDir: "scenes/recovery",
  exportDir: "exports",
} as const;

const PREFERENCE_KEYS = {
  recents: "draw/recents",
  settings: "draw/settings",
} as const;

const WEB_DATA_PREFIX = "draw/data/";

const MAX_RECENT_SCENES = 8;

export type DrawSettings = {
  preferNativeStylusBridge: boolean;
  forcePenMode: boolean;
};

export type SceneSnapshotMeta = {
  id: string;
  title: string;
  updatedAt: string;
  path: string;
  elementCount: number;
};

export type ScenePayload = {
  elements: readonly OrderedExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
};

export type BootstrapState = {
  initialData: ExcalidrawInitialDataState | null;
  libraryItems: LibraryItems;
  recents: SceneSnapshotMeta[];
  settings: DrawSettings;
  importNotice?: string;
};

export type SavedExport = {
  filename: string;
  path: string;
  uri?: string;
  downloaded: boolean;
};

export const DEFAULT_SETTINGS: DrawSettings = {
  preferNativeStylusBridge: true,
  forcePenMode: false,
};

const toWebDataKey = (path: string) => `${WEB_DATA_PREFIX}${path}`;

const bytesToBinary = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return binary;
};

const textToBase64 = (value: string) =>
  btoa(bytesToBinary(new TextEncoder().encode(value)));

const base64ToText = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
};

const safeJsonParse = <T>(value: string | null, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const ensureDataDirectory = async (path: string) => {
  const parts = path.split("/");
  if (parts.length < 2) {
    return;
  }

  await Filesystem.mkdir({
    path: parts.slice(0, -1).join("/"),
    directory: Directory.Data,
    recursive: true,
  });
};

const ensureDocumentsDirectory = async (path: string) => {
  const parts = path.split("/");
  if (parts.length < 2) {
    return;
  }

  await Filesystem.mkdir({
    path: parts.slice(0, -1).join("/"),
    directory: Directory.Documents,
    recursive: true,
  });
};

const readDataText = async (path: string) => {
  if (!isNativePlatform) {
    try {
      return window.localStorage.getItem(toWebDataKey(path));
    } catch {
      return null;
    }
  }

  try {
    const result = await Filesystem.readFile({
      path,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return typeof result.data === "string" ? result.data : null;
  } catch {
    try {
      const result = await Filesystem.readFile({
        path,
        directory: Directory.Data,
      });

      if (typeof result.data !== "string") {
        return null;
      }

      return base64ToText(result.data);
    } catch {
      return null;
    }
  }
};

const writeDataText = async (path: string, text: string) => {
  if (!isNativePlatform) {
    try {
      window.localStorage.setItem(toWebDataKey(path), text);
      return;
    } catch {
      throw new Error("Web storage is unavailable");
    }
  }

  await ensureDataDirectory(path);

  try {
    await Filesystem.writeFile({
      path,
      directory: Directory.Data,
      data: text,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  } catch {
    await Filesystem.writeFile({
      path,
      directory: Directory.Data,
      data: textToBase64(text),
      recursive: true,
    });
  }
};

const removeDataFile = async (path: string) => {
  if (!isNativePlatform) {
    try {
      window.localStorage.removeItem(toWebDataKey(path));
    } catch {
      // ignore storage removal issues
    }
    return;
  }

  try {
    await Filesystem.deleteFile({
      path,
      directory: Directory.Data,
    });
  } catch {
    // ignore missing files
  }
};

const downloadText = (filename: string, text: string, mimeType: string) => {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const downloadBlob = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const blobToBase64 = async (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") {
        reject(new Error("Unable to serialize blob"));
        return;
      }
      resolve(dataUrl.split(",")[1] ?? "");
    };
    reader.readAsDataURL(blob);
  });

const base64ToBlob = (base64: string, mimeType: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
};

const sanitizeFilename = (filename: string) =>
  filename
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "untitled";

const extensionFromFilename = (filename: string) => {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex);
};

const sceneBlobFromPendingOpen = (pendingOpen: PendingOpenPayload) => {
  const mimeType = pendingOpen.mimeType || MIME_TYPES.excalidraw;
  if (pendingOpen.encoding === "base64") {
    return base64ToBlob(pendingOpen.data, mimeType);
  }
  return new Blob([pendingOpen.data], { type: mimeType });
};

const loadSceneFromText = async (
  text: string,
  libraryItems: LibraryItems,
): Promise<ExcalidrawInitialDataState> => {
  const scene = await loadFromBlob(
    new Blob([text], { type: MIME_TYPES.excalidraw }),
    null,
    null,
  );
  return {
    ...scene,
    libraryItems,
  };
};

const loadSceneFromPendingOpen = async (
  pendingOpen: PendingOpenPayload,
  libraryItems: LibraryItems,
) => {
  const blob = sceneBlobFromPendingOpen(pendingOpen);
  return loadFromBlob(blob, null, null).then((scene) => ({
    ...scene,
    libraryItems,
  }));
};

export const makeSceneTitle = (name?: string | null) =>
  name?.trim() || "Untitled scene";

export const sceneHasContent = (scene: ScenePayload) =>
  scene.elements.some((element) => !element.isDeleted);

export const serializeScene = (scene: ScenePayload) =>
  serializeAsJSON(scene.elements, scene.appState, scene.files, "local");

export const serializeLibrary = (libraryItems: LibraryItems) =>
  serializeLibraryAsJSON(libraryItems);

export const readSettings = async () => {
  const { value } = await Preferences.get({ key: PREFERENCE_KEYS.settings });
  return {
    ...DEFAULT_SETTINGS,
    ...safeJsonParse<Partial<DrawSettings>>(value, {}),
  };
};

export const persistSettings = async (settings: DrawSettings) => {
  await Preferences.set({
    key: PREFERENCE_KEYS.settings,
    value: JSON.stringify(settings),
  });
};

export const readRecentScenes = async () => {
  const { value } = await Preferences.get({ key: PREFERENCE_KEYS.recents });
  return safeJsonParse<SceneSnapshotMeta[]>(value, []);
};

const persistRecentScenes = async (recents: SceneSnapshotMeta[]) => {
  await Preferences.set({
    key: PREFERENCE_KEYS.recents,
    value: JSON.stringify(recents),
  });
};

export const persistLibrary = async (libraryItems: LibraryItems) => {
  await writeDataText(APP_PATHS.library, serializeLibrary(libraryItems));
};

export const writeAutosave = async (serializedScene: string) => {
  await writeDataText(APP_PATHS.autosave, serializedScene);
};

export const loadSceneFromPath = async (
  path: string,
  libraryItems: LibraryItems,
) => {
  const text = await readDataText(path);
  if (!text) {
    throw new Error(`Scene at ${path} is unavailable`);
  }
  return loadSceneFromText(text, libraryItems);
};

export const saveRecoverySnapshot = async (options: {
  serializedScene: string;
  title: string;
  elementCount: number;
  recents: SceneSnapshotMeta[];
}) => {
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${APP_PATHS.recoveryDir}/${id}.excalidraw`;
  const nextEntry: SceneSnapshotMeta = {
    id,
    title: options.title,
    updatedAt: new Date().toISOString(),
    path,
    elementCount: options.elementCount,
  };

  await writeDataText(path, options.serializedScene);

  const nextRecents = [
    nextEntry,
    ...options.recents.filter((entry) => entry.path !== path),
  ].slice(0, MAX_RECENT_SCENES);

  const removedEntries = options.recents.filter(
    (entry) => !nextRecents.some((nextEntryItem) => nextEntryItem.path === entry.path),
  );
  await Promise.all(removedEntries.map((entry) => removeDataFile(entry.path)));
  await persistRecentScenes(nextRecents);
  return nextRecents;
};

export const saveTextExport = async (
  filename: string,
  text: string,
  mimeType: string,
): Promise<SavedExport> => {
  if (!isNativePlatform) {
    downloadText(filename, text, mimeType);
    return {
      filename,
      path: filename,
      downloaded: true,
    };
  }

  const path = `${APP_PATHS.exportDir}/${filename}`;
  await ensureDocumentsDirectory(path);
  await Filesystem.writeFile({
    path,
    directory: Directory.Documents,
    data: text,
    encoding: Encoding.UTF8,
    recursive: true,
  });

  const { uri } = await Filesystem.getUri({
    path,
    directory: Directory.Documents,
  });

  return {
    filename,
    path,
    uri,
    downloaded: false,
  };
};

export const saveBlobExport = async (
  filename: string,
  blob: Blob,
): Promise<SavedExport> => {
  if (!isNativePlatform) {
    downloadBlob(filename, blob);
    return {
      filename,
      path: filename,
      downloaded: true,
    };
  }

  const path = `${APP_PATHS.exportDir}/${filename}`;
  await ensureDocumentsDirectory(path);
  await Filesystem.writeFile({
    path,
    directory: Directory.Documents,
    data: await blobToBase64(blob),
    recursive: true,
  });

  const { uri } = await Filesystem.getUri({
    path,
    directory: Directory.Documents,
  });

  return {
    filename,
    path,
    uri,
    downloaded: false,
  };
};

export const suggestedFilename = (
  title: string,
  extension: ".excalidraw" | ".excalidrawlib" | ".png" | ".svg",
) => {
  const base = sanitizeFilename(title);
  const existingExtension = extensionFromFilename(base);
  if (existingExtension === extension) {
    return base;
  }
  return `${base}${extension}`;
};

export const loadAppBootstrap = async (
  pendingOpen: PendingOpenPayload | null,
): Promise<BootstrapState> => {
  let libraryItems: LibraryItems = [];

  const libraryText = await readDataText(APP_PATHS.library);
  if (libraryText) {
    try {
      libraryItems = (await loadLibraryFromBlob(
        new Blob([libraryText], { type: MIME_TYPES.excalidrawlib }),
      )) as LibraryItems;
    } catch {
      libraryItems = [];
    }
  }

  const [recents, settings] = await Promise.all([
    readRecentScenes(),
    readSettings(),
  ]);

  if (pendingOpen) {
    try {
      if (pendingOpen.name.endsWith(".excalidrawlib")) {
        libraryItems = (await loadLibraryFromBlob(
          sceneBlobFromPendingOpen(pendingOpen),
        )) as LibraryItems;
        await persistLibrary(libraryItems);
        return {
          initialData: {
            appState: { showWelcomeScreen: true },
            libraryItems,
          },
          libraryItems,
          recents,
          settings,
          importNotice: `Imported library from ${pendingOpen.name}`,
        };
      }

      return {
        initialData: await loadSceneFromPendingOpen(pendingOpen, libraryItems),
        libraryItems,
        recents,
        settings,
        importNotice: `Opened ${pendingOpen.name}`,
      };
    } catch {
      return {
        initialData: {
          appState: { showWelcomeScreen: true },
          libraryItems,
        },
        libraryItems,
        recents,
        settings,
        importNotice: `Could not load ${pendingOpen.name}`,
      };
    }
  }

  const autosaveText = await readDataText(APP_PATHS.autosave);
  if (!autosaveText) {
    return {
      initialData: {
        appState: { showWelcomeScreen: true },
        libraryItems,
      },
      libraryItems,
      recents,
      settings,
    };
  }

  try {
    return {
      initialData: await loadSceneFromText(autosaveText, libraryItems),
      libraryItems,
      recents,
      settings,
    };
  } catch {
    return {
      initialData: {
        appState: { showWelcomeScreen: true },
        libraryItems,
      },
      libraryItems,
      recents,
      settings,
      importNotice: "Autosave recovery was unavailable, starting fresh.",
    };
  }
};
