import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import {
  MIME_TYPES,
  loadFromBlob,
  loadLibraryFromBlob,
  serializeAsJSON,
  serializeLibraryAsJSON,
} from "@excalidraw/excalidraw";

import { isAndroid, isNativePlatform } from "./capacitor";
import {
  DEFAULT_PAGE_SETTINGS,
  PAGE_SETTINGS_METADATA_KEY,
  normalizePageSettings,
  type PageSettings,
} from "./pageSettings";
import { createStoreZip, parseStoreZip } from "./simpleZip";
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
  canvasIndex: "canvas-manager/index.json",
  thumbnailDir: "canvas-manager/thumbnails",
  versionsDir: "canvas-manager/versions",
} as const;

const USER_STORAGE_PATHS = {
  root: "Excalidraw",
  canvasesDir: "Excalidraw/canvases",
  librariesDir: "Excalidraw/libraries",
  exportsDir: "Excalidraw/exports",
  backupsDir: "Excalidraw/backups",
} as const;

const PREFERENCE_KEYS = {
  recents: "draw/recents",
  settings: "draw/settings",
  legacyMigrationComplete: "draw/legacyMigrationComplete",
} as const;

const WEB_DATA_PREFIX = "draw/data/";

const MAX_RECENT_SCENES = 8;
const BASE64_WRITE_CHUNK_SIZE = 256 * 1024;

type NativeStorageDirectory =
  | Directory.Data
  | Directory.Documents
  | Directory.External;

export type SavedSceneLocation = "external" | "documents" | "data";

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
  pageSettings: PageSettings;
  libraryItems: LibraryItems;
  recents: SceneSnapshotMeta[];
  settings: DrawSettings;
  importNotice?: string;
};

export type LoadedSceneData = ExcalidrawInitialDataState & {
  pageSettings?: PageSettings;
};

export type SavedExport = {
  filename: string;
  path: string;
  uri?: string;
  downloaded: boolean;
};

export type SavedSceneFile = {
  name: string;
  path: string;
  uri?: string;
  mtime: number;
  size: number;
  location: SavedSceneLocation;
  canvasId?: string;
  thumbnailUri?: string | null;
  elementCount?: number;
};

export type CanvasVersionMeta = {
  id: string;
  title: string;
  createdAt: string;
  path: string;
  elementCount: number;
  size: number;
};

export type BackupRestoreSummary = {
  restored: number;
  renamed: number;
  skipped: number;
  files: string[];
};

export type DeleteSavedSceneSummary = {
  deleted: number;
  locations: SavedSceneLocation[];
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
  bytesToBase64(new TextEncoder().encode(value));

const bytesToBase64 = (bytes: Uint8Array) => btoa(bytesToBinary(bytes));

const base64ToText = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
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

const isLegacyMigrationComplete = async () => {
  const { value } = await Preferences.get({
    key: PREFERENCE_KEYS.legacyMigrationComplete,
  });
  return value === "true";
};

const markLegacyMigrationComplete = async () => {
  await Preferences.set({
    key: PREFERENCE_KEYS.legacyMigrationComplete,
    value: "true",
  });
};

const ensureDataDirectory = async (path: string) => {
  await ensureNativeDirectory(path, Directory.Data);
};

const ensureNativeDirectory = async (
  path: string,
  directory: NativeStorageDirectory,
) => {
  const parts = path.split("/");
  if (parts.length < 2) {
    return;
  }

  try {
    await Filesystem.mkdir({
      path: parts.slice(0, -1).join("/"),
      directory,
      recursive: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "");
    if (/exist/i.test(message)) {
      return;
    }
    throw error;
  }
};

const writeBase64FileNative = async (
  path: string,
  directory: NativeStorageDirectory,
  base64Data: string,
) => {
  const firstChunk = base64Data.slice(0, BASE64_WRITE_CHUNK_SIZE);
  await Filesystem.writeFile({
    path,
    directory,
    data: firstChunk,
    recursive: true,
  });

  for (
    let offset = BASE64_WRITE_CHUNK_SIZE;
    offset < base64Data.length;
    offset += BASE64_WRITE_CHUNK_SIZE
  ) {
    await Filesystem.appendFile({
      path,
      directory,
      data: base64Data.slice(offset, offset + BASE64_WRITE_CHUNK_SIZE),
    });
  }
};

const writeTextFileNative = async (
  path: string,
  directory: NativeStorageDirectory,
  text: string,
) => {
  await writeBase64FileNative(path, directory, textToBase64(text));
};

const copyLegacyExternalFilesToDocuments = async (directoryPath: string) => {
  try {
    const listing = await Filesystem.readdir({
      path: directoryPath,
      directory: Directory.External,
    });

    await Promise.all(
      listing.files
        .filter((file) => file.type === "file")
        .map(async (file) => {
          const filePath = `${directoryPath}/${file.name}`;

          try {
            await Filesystem.stat({
              path: filePath,
              directory: Directory.Documents,
            });
            return;
          } catch {
            // Missing in Documents, so copy the old app-specific export over.
          }

          try {
            await ensureNativeDirectory(filePath, Directory.Documents);
            await Filesystem.copy({
              from: filePath,
              directory: Directory.External,
              to: filePath,
              toDirectory: Directory.Documents,
            });
          } catch {
            // Keep startup resilient if one legacy file cannot be migrated.
          }
        }),
    );
  } catch {
    // Legacy external storage may not exist on a fresh install.
  }
};

const migrateLegacyExternalUserStorage = async () => {
  if (!isAndroid) {
    return;
  }

  if (await isLegacyMigrationComplete()) {
    return;
  }

  try {
    await Promise.all([
      copyLegacyExternalFilesToDocuments(USER_STORAGE_PATHS.canvasesDir),
      copyLegacyExternalFilesToDocuments(USER_STORAGE_PATHS.librariesDir),
      copyLegacyExternalFilesToDocuments(USER_STORAGE_PATHS.exportsDir),
    ]);
  } finally {
    await markLegacyMigrationComplete();
  }
};

const ensureUserStorageDirectories = async (
  options: { migrateLegacy?: boolean } = {},
) => {
  if (!isNativePlatform) {
    return;
  }

  const storagePaths = [
    USER_STORAGE_PATHS.root,
    USER_STORAGE_PATHS.canvasesDir,
    USER_STORAGE_PATHS.librariesDir,
    USER_STORAGE_PATHS.exportsDir,
    USER_STORAGE_PATHS.backupsDir,
  ] as const;

  await Promise.all(
    storagePaths.map((path) =>
      Filesystem.mkdir({
        path,
        directory: Directory.Data,
        recursive: true,
      }),
    ),
  ).catch(() => undefined);

  await Promise.all(
    storagePaths.map((path) =>
      Filesystem.mkdir({
        path,
        directory: Directory.Documents,
        recursive: true,
      }),
    ),
  ).catch(() => undefined);

  if (options.migrateLegacy) {
    await migrateLegacyExternalUserStorage();
  } else {
    await markLegacyMigrationComplete();
  }
};

const getNativeExportDirectories = (): NativeStorageDirectory[] => {
  if (isAndroid) {
    return [Directory.Documents];
  }

  return [Directory.Documents, Directory.Data];
};

const getNativeSceneSearchDirectories = (): NativeStorageDirectory[] => {
  if (isAndroid) {
    return [Directory.Documents];
  }

  return getNativeExportDirectories();
};

const toSavedSceneLocation = (
  directory: NativeStorageDirectory,
): SavedSceneLocation => {
  if (directory === Directory.External) {
    return "external";
  }
  if (directory === Directory.Documents) {
    return "documents";
  }
  return "data";
};

const toNativeStorageDirectory = (
  location: SavedSceneLocation,
): NativeStorageDirectory => {
  if (location === "external") {
    return Directory.External;
  }
  if (location === "documents") {
    return Directory.Documents;
  }
  return Directory.Data;
};

const readTextFileNative = async (
  path: string,
  directory: NativeStorageDirectory,
) => {
  try {
    const result = await Filesystem.readFile({
      path,
      directory,
      encoding: Encoding.UTF8,
    });
    if (typeof result.data === "string") {
      return result.data;
    }
  } catch {
    // Fall through to base64 read.
  }

  const result = await Filesystem.readFile({
    path,
    directory,
  });

  if (typeof result.data !== "string") {
    throw new Error("Could not decode saved scene");
  }

  return base64ToText(result.data);
};

const readBinaryFileNative = async (
  path: string,
  directory: NativeStorageDirectory,
) => {
  const result = await Filesystem.readFile({
    path,
    directory,
  });

  if (typeof result.data === "string") {
    return base64ToBytes(result.data);
  }

  if (result.data instanceof Blob) {
    return new Uint8Array(await result.data.arrayBuffer());
  }

  throw new Error("Could not decode file");
};

const writeBinaryFileNative = async (
  path: string,
  directory: NativeStorageDirectory,
  bytes: Uint8Array,
) => {
  await writeBase64FileNative(path, directory, bytesToBase64(bytes));
};

const getExportTargetPath = (filename: string) => {
  const extension = extensionFromFilename(filename).toLowerCase();
  if (extension === ".excalidraw") {
    return `${USER_STORAGE_PATHS.canvasesDir}/${filename}`;
  }
  if (extension === ".excalidrawlib") {
    return `${USER_STORAGE_PATHS.librariesDir}/${filename}`;
  }
  return `${USER_STORAGE_PATHS.exportsDir}/${filename}`;
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
  await writeTextFileNative(path, Directory.Data, text);
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

const pageSettingsFromSceneText = (text: string) =>
  normalizePageSettings(
    safeJsonParse<Record<string, unknown>>(text, {})[PAGE_SETTINGS_METADATA_KEY],
  );

const withPageSettingsMetadata = (
  serializedScene: string,
  pageSettings: PageSettings,
) => {
  const sceneData = safeJsonParse<Record<string, unknown>>(
    serializedScene,
    {},
  );

  if (!Object.keys(sceneData).length) {
    return serializedScene;
  }

  if (
    pageSettings.template === DEFAULT_PAGE_SETTINGS.template &&
    pageSettings.mode === DEFAULT_PAGE_SETTINGS.mode
  ) {
    delete sceneData[PAGE_SETTINGS_METADATA_KEY];
  } else {
    sceneData[PAGE_SETTINGS_METADATA_KEY] = pageSettings;
  }

  return JSON.stringify(sceneData, null, 2);
};

const loadSceneFromText = async (
  text: string,
  libraryItems: LibraryItems,
): Promise<LoadedSceneData> => {
  const scene = await loadFromBlob(
    new Blob([text], { type: MIME_TYPES.excalidraw }),
    null,
    null,
  );
  return {
    ...scene,
    libraryItems,
    pageSettings: pageSettingsFromSceneText(text),
  };
};

const loadSceneFromPendingOpen = async (
  pendingOpen: PendingOpenPayload,
  libraryItems: LibraryItems,
) => {
  const blob = sceneBlobFromPendingOpen(pendingOpen);
  return loadSceneFromText(await blob.text(), libraryItems);
};

export const loadSceneFromBlobData = async (
  blob: Blob,
  libraryItems: LibraryItems,
) => loadSceneFromText(await blob.text(), libraryItems);

export const makeSceneTitle = (name?: string | null) =>
  name?.trim() || "Untitled scene";

export const sceneHasContent = (scene: ScenePayload) =>
  scene.elements.some((element) => !element.isDeleted);

export const serializeScene = (
  scene: ScenePayload,
  pageSettings: PageSettings = DEFAULT_PAGE_SETTINGS,
) =>
  withPageSettingsMetadata(
    serializeAsJSON(scene.elements, scene.appState, scene.files, "local"),
    pageSettings,
  );

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
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
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

  const path = getExportTargetPath(filename);
  await ensureUserStorageDirectories();
  const exportDirectories = getNativeExportDirectories();
  let lastError: unknown = null;

  for (const directory of exportDirectories) {
    try {
      await ensureNativeDirectory(path, directory);
      if (extensionFromFilename(filename).toLowerCase() === ".excalidraw") {
        await recordExistingSceneRevision(path, directory).catch(() => undefined);
      }
      await writeTextFileNative(path, directory, text);
      const { uri } = await Filesystem.getUri({
        path,
        directory,
      });
      return {
        filename,
        path,
        uri,
        downloaded: false,
      };
    } catch (error) {
      lastError = error;
      // Try the next location.
    }
  }

  const reason =
    lastError instanceof Error && lastError.message
      ? ` (${lastError.message})`
      : "";
  throw new Error(`Unable to save export to device storage${reason}`);
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

  const path = getExportTargetPath(filename);
  const blobBase64 = await blobToBase64(blob);
  await ensureUserStorageDirectories();
  const exportDirectories = getNativeExportDirectories();
  let lastError: unknown = null;

  for (const directory of exportDirectories) {
    try {
      await ensureNativeDirectory(path, directory);
      await writeBase64FileNative(path, directory, blobBase64);

      const { uri } = await Filesystem.getUri({
        path,
        directory,
      });

      return {
        filename,
        path,
        uri,
        downloaded: false,
      };
    } catch (error) {
      lastError = error;
      // Try the next location.
    }
  }

  const reason =
    lastError instanceof Error && lastError.message
      ? ` (${lastError.message})`
      : "";
  throw new Error(`Unable to save export to device storage${reason}`);
};

export const listSavedScenesFromDevice = async (): Promise<SavedSceneFile[]> => {
  if (!isNativePlatform) {
    return [];
  }

  await ensureUserStorageDirectories();

  const scenesByName = new Map<string, SavedSceneFile>();
  const locationPriority: Record<SavedSceneLocation, number> = {
    documents: 0,
    external: 1,
    data: 2,
  };

  for (const directory of getNativeSceneSearchDirectories()) {
    try {
      const listing = await Filesystem.readdir({
        path: USER_STORAGE_PATHS.canvasesDir,
        directory,
      });

      for (const file of listing.files) {
        if (file.type !== "file" || !file.name.toLowerCase().endsWith(".excalidraw")) {
          continue;
        }

        const location = toSavedSceneLocation(directory);
        const nextEntry: SavedSceneFile = {
          name: file.name,
          path: `${USER_STORAGE_PATHS.canvasesDir}/${file.name}`,
          uri: file.uri,
          mtime: file.mtime ?? 0,
          size: file.size ?? 0,
          location,
        };

        const existingEntry = scenesByName.get(file.name);
        if (!existingEntry) {
          scenesByName.set(file.name, nextEntry);
          continue;
        }

        if (nextEntry.mtime > existingEntry.mtime) {
          scenesByName.set(file.name, nextEntry);
          continue;
        }

        if (
          nextEntry.mtime === existingEntry.mtime &&
          locationPriority[nextEntry.location] < locationPriority[existingEntry.location]
        ) {
          scenesByName.set(file.name, nextEntry);
        }
      }
    } catch {
      // Directory may be unavailable on this platform/profile.
    }
  }

  const sortedScenes = [...scenesByName.values()].sort((first, second) => {
    if (second.mtime !== first.mtime) {
      return second.mtime - first.mtime;
    }
    return first.name.localeCompare(second.name);
  });

  return Promise.all(
    sortedScenes.map(async (savedScene) => ({
      ...savedScene,
      canvasId: await resolveCanvasId(savedScene),
      thumbnailUri: await getSavedSceneThumbnail(savedScene),
    })),
  );
};

export const loadSceneFromSavedDeviceFile = async (
  savedScene: SavedSceneFile,
  libraryItems: LibraryItems,
): Promise<ExcalidrawInitialDataState> => {
  const text = await readTextFileNative(
    savedScene.path,
    toNativeStorageDirectory(savedScene.location),
  );
  return loadSceneFromText(text, libraryItems);
};

export const suggestedFilename = (
  title: string,
  extension: ".excalidraw" | ".excalidrawlib" | ".png" | ".svg" | ".pdf",
) => {
  const base = sanitizeFilename(title);
  const existingExtension = extensionFromFilename(base);
  if (existingExtension === extension) {
    return base;
  }
  return `${base}${extension}`;
};

type CanvasIndexEntry = {
  id: string;
  name: string;
  path: string;
  location: SavedSceneLocation;
  updatedAt: string;
};

type CanvasIndex = Record<string, CanvasIndexEntry>;

type ThumbnailMeta = {
  path: string;
  location: SavedSceneLocation;
  mtime: number;
  size: number;
  updatedAt: string;
};

const savedSceneKey = (savedScene: Pick<SavedSceneFile, "location" | "path">) =>
  `${savedScene.location}:${savedScene.path}`;

const makeStableId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const hashCacheKey = (value: string) => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) + hash + value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
};

const readCanvasIndex = async (): Promise<CanvasIndex> =>
  safeJsonParse<CanvasIndex>(await readDataText(APP_PATHS.canvasIndex), {});

const writeCanvasIndex = async (index: CanvasIndex) => {
  await writeDataText(APP_PATHS.canvasIndex, JSON.stringify(index, null, 2));
};

const resolveCanvasId = async (savedScene: SavedSceneFile) => {
  const index = await readCanvasIndex();
  const key = savedSceneKey(savedScene);
  const existingEntry = index[key];

  if (existingEntry?.id) {
    if (
      existingEntry.name !== savedScene.name ||
      existingEntry.path !== savedScene.path ||
      existingEntry.location !== savedScene.location
    ) {
      index[key] = {
        ...existingEntry,
        name: savedScene.name,
        path: savedScene.path,
        location: savedScene.location,
        updatedAt: new Date().toISOString(),
      };
      await writeCanvasIndex(index);
    }
    return existingEntry.id;
  }

  const id = makeStableId();
  index[key] = {
    id,
    name: savedScene.name,
    path: savedScene.path,
    location: savedScene.location,
    updatedAt: new Date().toISOString(),
  };
  await writeCanvasIndex(index);
  return id;
};

const updateCanvasIndexForRename = async (
  fromScene: SavedSceneFile,
  toScene: SavedSceneFile,
) => {
  const index = await readCanvasIndex();
  const fromKey = savedSceneKey(fromScene);
  const toKey = savedSceneKey(toScene);
  const existingEntry = index[fromKey];
  const id = existingEntry?.id ?? makeStableId();

  delete index[fromKey];
  index[toKey] = {
    id,
    name: toScene.name,
    path: toScene.path,
    location: toScene.location,
    updatedAt: new Date().toISOString(),
  };
  await writeCanvasIndex(index);
  return id;
};

const removeCanvasIndexEntry = async (savedScene: SavedSceneFile) => {
  const index = await readCanvasIndex();
  delete index[savedSceneKey(savedScene)];
  await writeCanvasIndex(index);
};

const removeCanvasIndexEntriesForName = async (filename: string) => {
  const index = await readCanvasIndex();
  const normalizedSuffix = `/${filename}`;

  for (const [key, entry] of Object.entries(index)) {
    if (entry.name === filename || entry.path.endsWith(normalizedSuffix)) {
      delete index[key];
    }
  }

  await writeCanvasIndex(index);
};

const thumbnailCacheName = (savedScene: SavedSceneFile) =>
  hashCacheKey(savedSceneKey(savedScene));

const thumbnailDataPath = (savedScene: SavedSceneFile) =>
  `${APP_PATHS.thumbnailDir}/${thumbnailCacheName(savedScene)}.txt`;

const thumbnailMetaPath = (savedScene: SavedSceneFile) =>
  `${APP_PATHS.thumbnailDir}/${thumbnailCacheName(savedScene)}.json`;

const removeSavedSceneThumbnail = async (savedScene: SavedSceneFile) => {
  await Promise.all([
    removeDataFile(thumbnailDataPath(savedScene)),
    removeDataFile(thumbnailMetaPath(savedScene)),
  ]);
};

export const getSavedSceneThumbnail = async (savedScene: SavedSceneFile) => {
  const meta = safeJsonParse<ThumbnailMeta | null>(
    await readDataText(thumbnailMetaPath(savedScene)),
    null,
  );

  if (
    !meta ||
    meta.path !== savedScene.path ||
    meta.location !== savedScene.location ||
    meta.mtime !== savedScene.mtime ||
    meta.size !== savedScene.size
  ) {
    return null;
  }

  return readDataText(thumbnailDataPath(savedScene));
};

export const persistSavedSceneThumbnail = async (
  savedScene: SavedSceneFile,
  thumbnailUri: string,
) => {
  const meta: ThumbnailMeta = {
    path: savedScene.path,
    location: savedScene.location,
    mtime: savedScene.mtime,
    size: savedScene.size,
    updatedAt: new Date().toISOString(),
  };

  await Promise.all([
    writeDataText(thumbnailDataPath(savedScene), thumbnailUri),
    writeDataText(thumbnailMetaPath(savedScene), JSON.stringify(meta, null, 2)),
  ]);
};

const normalizeSceneFilename = (filename: string) =>
  suggestedFilename(filename, ".excalidraw");

const normalizeLibraryFilename = (filename: string) =>
  suggestedFilename(filename, ".excalidrawlib");

const filenameWithoutExtension = (filename: string) => {
  const extension = extensionFromFilename(filename);
  return extension ? filename.slice(0, -extension.length) : filename;
};

const sanitizeVisibleFilenamePart = (filename: string) =>
  filename
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "Untitled";

const withFilenameSuffix = (filename: string, suffix: string) => {
  const extension = extensionFromFilename(filename);
  const base = extension ? filename.slice(0, -extension.length) : filename;
  return `${base}${suffix}${extension}`;
};

const nativeFileExists = async (
  path: string,
  directory: NativeStorageDirectory,
) => {
  try {
    await Filesystem.stat({ path, directory });
    return true;
  } catch {
    return false;
  }
};

const statSavedScene = async (
  path: string,
  directory: NativeStorageDirectory,
  location: SavedSceneLocation,
) => {
  const stat = await Filesystem.stat({ path, directory });
  const { uri } = await Filesystem.getUri({ path, directory });
  const name = path.slice(path.lastIndexOf("/") + 1);
  const savedScene: SavedSceneFile = {
    name,
    path,
    uri,
    mtime: stat.mtime ?? 0,
    size: stat.size ?? 0,
    location,
  };

  return {
    ...savedScene,
    canvasId: await resolveCanvasId(savedScene),
    thumbnailUri: await getSavedSceneThumbnail(savedScene),
  };
};

const uniqueFilenameInDirectory = async (
  directoryPath: string,
  directory: NativeStorageDirectory,
  preferredFilename: string,
) => {
  const extension = extensionFromFilename(preferredFilename);
  const base = extension
    ? preferredFilename.slice(0, -extension.length)
    : preferredFilename;
  let candidate = preferredFilename;
  let counter = 2;

  while (await nativeFileExists(`${directoryPath}/${candidate}`, directory)) {
    candidate = `${base} ${counter}${extension}`;
    counter += 1;
  }

  return candidate;
};

const countSceneElements = (serializedScene: string) => {
  const parsed = safeJsonParse<{ elements?: Array<{ isDeleted?: boolean }> }>(
    serializedScene,
    {},
  );
  return parsed.elements?.filter((element) => !element.isDeleted).length ?? 0;
};

const canvasVersionIndexPath = (canvasId: string) =>
  `${APP_PATHS.versionsDir}/${canvasId}/index.json`;

const canvasVersionFilePath = (canvasId: string, versionId: string) =>
  `${APP_PATHS.versionsDir}/${canvasId}/${versionId}.excalidraw`;

const readCanvasVersionIndex = async (canvasId: string) =>
  safeJsonParse<CanvasVersionMeta[]>(
    await readDataText(canvasVersionIndexPath(canvasId)),
    [],
  );

const writeCanvasVersionIndex = async (
  canvasId: string,
  versions: readonly CanvasVersionMeta[],
) => {
  await writeDataText(
    canvasVersionIndexPath(canvasId),
    JSON.stringify(versions, null, 2),
  );
};

export const saveCanvasVersion = async (
  savedScene: SavedSceneFile,
  serializedScene: string,
  title: string,
  elementCount = countSceneElements(serializedScene),
) => {
  if (!serializedScene.trim()) {
    return null;
  }

  const canvasId = await resolveCanvasId(savedScene);
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const path = canvasVersionFilePath(canvasId, id);
  const nextVersion: CanvasVersionMeta = {
    id,
    title,
    createdAt: new Date().toISOString(),
    path,
    elementCount,
    size: new TextEncoder().encode(serializedScene).byteLength,
  };

  await writeDataText(path, serializedScene);

  const versions = [nextVersion, ...(await readCanvasVersionIndex(canvasId))]
    .filter(
      (version, index, allVersions) =>
        allVersions.findIndex((item) => item.id === version.id) === index,
    )
    .sort(
      (first, second) =>
        new Date(second.createdAt).getTime() -
        new Date(first.createdAt).getTime(),
    );
  const retainedVersions = versions.slice(0, 20);
  const removedVersions = versions.slice(20);

  await Promise.all(
    removedVersions.map((version) => removeDataFile(version.path)),
  );
  await writeCanvasVersionIndex(canvasId, retainedVersions);
  return nextVersion;
};

const recordExistingSceneRevision = async (
  path: string,
  directory: NativeStorageDirectory,
) => {
  if (!(await nativeFileExists(path, directory))) {
    return;
  }

  const location = toSavedSceneLocation(directory);
  const savedScene = await statSavedScene(path, directory, location);
  const serializedScene = await readTextFileNative(path, directory);
  await saveCanvasVersion(
    savedScene,
    serializedScene,
    `Before saving ${savedScene.name}`,
    countSceneElements(serializedScene),
  );
};

export const listCanvasVersions = async (savedScene: SavedSceneFile) => {
  const canvasId = await resolveCanvasId(savedScene);
  return readCanvasVersionIndex(canvasId);
};

export const restoreCanvasVersion = async (
  savedScene: SavedSceneFile,
  versionId: string,
  libraryItems: LibraryItems = [],
) => {
  const canvasId = await resolveCanvasId(savedScene);
  const versions = await readCanvasVersionIndex(canvasId);
  const version = versions.find((item) => item.id === versionId);

  if (!version) {
    throw new Error("Canvas version is unavailable");
  }

  const directory = toNativeStorageDirectory(savedScene.location);
  const currentScene = await readTextFileNative(savedScene.path, directory).catch(
    () => null,
  );

  if (currentScene) {
    await saveCanvasVersion(
      savedScene,
      currentScene,
      `Before restoring ${savedScene.name}`,
      countSceneElements(currentScene),
    );
  }

  const serializedScene = await readDataText(version.path);
  if (!serializedScene) {
    throw new Error("Canvas version file is unavailable");
  }

  await writeTextFileNative(savedScene.path, directory, serializedScene);
  await removeSavedSceneThumbnail(savedScene);
  return loadSceneFromText(serializedScene, libraryItems);
};

export const renameSavedScene = async (
  savedScene: SavedSceneFile,
  nextName: string,
) => {
  const filename = normalizeSceneFilename(nextName);
  const targetPath = `${USER_STORAGE_PATHS.canvasesDir}/${filename}`;
  const directory = toNativeStorageDirectory(savedScene.location);

  if (targetPath === savedScene.path) {
    return savedScene;
  }

  if (await nativeFileExists(targetPath, directory)) {
    throw new Error(`${filename} already exists`);
  }

  await Filesystem.rename({
    from: savedScene.path,
    directory,
    to: targetPath,
    toDirectory: directory,
  });

  const renamedScene = await statSavedScene(
    targetPath,
    directory,
    savedScene.location,
  );
  const canvasId = await updateCanvasIndexForRename(savedScene, renamedScene);
  await removeSavedSceneThumbnail(savedScene);
  return { ...renamedScene, canvasId };
};

export const duplicateSavedScene = async (savedScene: SavedSceneFile) => {
  const sourceDirectory = toNativeStorageDirectory(savedScene.location);
  const copyBase = `${sanitizeVisibleFilenamePart(
    filenameWithoutExtension(savedScene.name),
  )} Copy`;
  const preferredFilename = `${copyBase}.excalidraw`;
  const filename = await uniqueFilenameInDirectory(
    USER_STORAGE_PATHS.canvasesDir,
    Directory.Documents,
    preferredFilename,
  );
  const targetPath = `${USER_STORAGE_PATHS.canvasesDir}/${filename}`;
  const serializedScene = await readTextFileNative(
    savedScene.path,
    sourceDirectory,
  );

  await ensureUserStorageDirectories();
  await writeTextFileNative(targetPath, Directory.Documents, serializedScene);
  return statSavedScene(targetPath, Directory.Documents, "documents");
};

const getNativeSceneCleanupDirectories = (): NativeStorageDirectory[] => {
  if (isAndroid) {
    return [Directory.Documents, Directory.External, Directory.Data];
  }

  return [Directory.Documents, Directory.Data];
};

const savedSceneCopyForDirectory = (
  filename: string,
  directory: NativeStorageDirectory,
): SavedSceneFile => ({
  name: filename,
  path: `${USER_STORAGE_PATHS.canvasesDir}/${filename}`,
  mtime: 0,
  size: 0,
  location: toSavedSceneLocation(directory),
});

const deleteSceneCopiesByName = async (
  filename: string,
  primaryLocation?: SavedSceneLocation,
): Promise<DeleteSavedSceneSummary> => {
  const deletedLocations: SavedSceneLocation[] = [];
  let primaryDeleteError: unknown = null;

  for (const directory of getNativeSceneCleanupDirectories()) {
    const path = `${USER_STORAGE_PATHS.canvasesDir}/${filename}`;
    const location = toSavedSceneLocation(directory);
    const savedSceneCopy = savedSceneCopyForDirectory(filename, directory);

    await removeSavedSceneThumbnail(savedSceneCopy);

    if (!(await nativeFileExists(path, directory))) {
      continue;
    }

    try {
      await Filesystem.deleteFile({ path, directory });
      deletedLocations.push(location);
    } catch (error) {
      if (location === primaryLocation) {
        primaryDeleteError = error;
      }
    }
  }

  await removeCanvasIndexEntriesForName(filename);

  if (primaryDeleteError) {
    throw primaryDeleteError;
  }

  return {
    deleted: deletedLocations.length,
    locations: deletedLocations,
  };
};

export const deleteSavedScene = async (
  savedScene: SavedSceneFile,
): Promise<DeleteSavedSceneSummary> => {
  const summary = await deleteSceneCopiesByName(
    savedScene.name,
    savedScene.location,
  );
  await removeCanvasIndexEntry(savedScene);
  return summary;
};

export const saveImportedSceneFile = async (filename: string, text: string) => {
  if (!isNativePlatform) {
    downloadText(normalizeSceneFilename(filename), text, MIME_TYPES.excalidraw);
    return {
      filename: normalizeSceneFilename(filename),
      path: normalizeSceneFilename(filename),
      downloaded: true,
    };
  }

  await ensureUserStorageDirectories();
  const targetFilename = await uniqueFilenameInDirectory(
    USER_STORAGE_PATHS.canvasesDir,
    Directory.Documents,
    normalizeSceneFilename(filename),
  );
  const path = `${USER_STORAGE_PATHS.canvasesDir}/${targetFilename}`;
  await writeTextFileNative(path, Directory.Documents, text);
  return {
    filename: targetFilename,
    path,
    uri: (await Filesystem.getUri({ path, directory: Directory.Documents })).uri,
    downloaded: false,
  };
};

export const saveImportedLibraryFile = async (filename: string, text: string) => {
  if (!isNativePlatform) {
    downloadText(
      normalizeLibraryFilename(filename),
      text,
      MIME_TYPES.excalidrawlib,
    );
    return {
      filename: normalizeLibraryFilename(filename),
      path: normalizeLibraryFilename(filename),
      downloaded: true,
    };
  }

  await ensureUserStorageDirectories();
  const targetFilename = await uniqueFilenameInDirectory(
    USER_STORAGE_PATHS.librariesDir,
    Directory.Documents,
    normalizeLibraryFilename(filename),
  );
  const path = `${USER_STORAGE_PATHS.librariesDir}/${targetFilename}`;
  await writeTextFileNative(path, Directory.Documents, text);
  return {
    filename: targetFilename,
    path,
    uri: (await Filesystem.getUri({ path, directory: Directory.Documents })).uri,
    downloaded: false,
  };
};

const formatBackupTimestamp = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(
    date.getDate(),
  )}-${pad(date.getHours())}${pad(date.getMinutes())}`;
};

const readBackupSourceFiles = async (
  rootDirectory: "canvases" | "libraries" | "exports",
) => {
  const fullPath = `${USER_STORAGE_PATHS.root}/${rootDirectory}`;
  const listing = await Filesystem.readdir({
    path: fullPath,
    directory: Directory.Documents,
  }).catch(() => ({ files: [] }));

  return Promise.all(
    listing.files
      .filter((file) => file.type === "file")
      .map(async (file) => {
        const path = `${fullPath}/${file.name}`;
        return {
          path,
          entryName: `${rootDirectory}/${file.name}`,
          size: file.size ?? 0,
          data: await readBinaryFileNative(path, Directory.Documents),
        };
      }),
  );
};

export const createBackupZip = async (): Promise<SavedExport> => {
  const filename = `escalidraw-backup-${formatBackupTimestamp(new Date())}.zip`;

  if (!isNativePlatform) {
    const blob = createStoreZip([
      {
        name: "manifest.json",
        data: JSON.stringify(
          {
            app: "Escalidraw",
            version: 1,
            createdAt: new Date().toISOString(),
            files: [],
          },
          null,
          2,
        ),
      },
    ]);
    downloadBlob(filename, blob);
    return { filename, path: filename, downloaded: true };
  }

  await ensureUserStorageDirectories();
  const files = (
    await Promise.all([
      readBackupSourceFiles("canvases"),
      readBackupSourceFiles("libraries"),
      readBackupSourceFiles("exports"),
    ])
  ).flat();
  const manifest = {
    app: "Escalidraw",
    version: 1,
    createdAt: new Date().toISOString(),
    root: "Documents/Excalidraw",
    files: files.map((file) => ({
      path: file.entryName,
      size: file.data.length,
    })),
  };
  const zip = createStoreZip([
    {
      name: "manifest.json",
      data: JSON.stringify(manifest, null, 2),
    },
    ...files.map((file) => ({
      name: file.entryName,
      data: file.data,
    })),
  ]);
  const path = `${USER_STORAGE_PATHS.backupsDir}/${filename}`;
  await writeBinaryFileNative(
    path,
    Directory.Documents,
    new Uint8Array(await zip.arrayBuffer()),
  );

  return {
    filename,
    path,
    uri: (await Filesystem.getUri({ path, directory: Directory.Documents })).uri,
    downloaded: false,
  };
};

const isSafeBackupEntryPath = (path: string) => {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === ".." || part === "")
  ) {
    return false;
  }

  return (
    path === "manifest.json" ||
    path.startsWith("canvases/") ||
    path.startsWith("libraries/") ||
    path.startsWith("exports/")
  );
};

const restoreConflictFilename = (filename: string, timestamp: string) =>
  withFilenameSuffix(filename, `-restored-${timestamp}`);

export const restoreBackupZip = async (
  file: Blob,
): Promise<BackupRestoreSummary> => {
  if (!isNativePlatform) {
    throw new Error("Backup restore is only available in the packaged app");
  }

  await ensureUserStorageDirectories();
  const entries = await parseStoreZip(file);
  const manifestEntry = entries.find((entry) => entry.name === "manifest.json");

  if (!manifestEntry) {
    throw new Error("Backup manifest is missing");
  }

  const manifest = safeJsonParse<{ app?: string; version?: number }>(
    new TextDecoder().decode(manifestEntry.data),
    {},
  );

  if (manifest.app !== "Escalidraw" || manifest.version !== 1) {
    throw new Error("Backup manifest is not compatible");
  }

  const timestamp = formatBackupTimestamp(new Date());
  const summary: BackupRestoreSummary = {
    restored: 0,
    renamed: 0,
    skipped: 0,
    files: [],
  };

  for (const entry of entries) {
    if (entry.name === "manifest.json") {
      continue;
    }

    if (!isSafeBackupEntryPath(entry.name)) {
      summary.skipped += 1;
      continue;
    }

    const pathParts = entry.name.split("/");
    const filename = pathParts[pathParts.length - 1];
    const directoryPath = `${USER_STORAGE_PATHS.root}/${pathParts
      .slice(0, -1)
      .join("/")}`;
    let targetFilename = filename;
    let targetPath = `${directoryPath}/${targetFilename}`;

    if (await nativeFileExists(targetPath, Directory.Documents)) {
      targetFilename = restoreConflictFilename(filename, timestamp);
      targetPath = `${directoryPath}/${targetFilename}`;
      let counter = 2;
      while (await nativeFileExists(targetPath, Directory.Documents)) {
        targetFilename = withFilenameSuffix(
          filename,
          `-restored-${timestamp}-${counter}`,
        );
        targetPath = `${directoryPath}/${targetFilename}`;
        counter += 1;
      }
      summary.renamed += 1;
    }

    await writeBinaryFileNative(targetPath, Directory.Documents, entry.data);
    summary.restored += 1;
    summary.files.push(targetPath);
  }

  return summary;
};

export const loadAppBootstrap = async (
  pendingOpen: PendingOpenPayload | null,
): Promise<BootstrapState> => {
  await ensureUserStorageDirectories();

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
          pageSettings: DEFAULT_PAGE_SETTINGS,
          libraryItems,
          recents,
          settings,
          importNotice: `Imported library from ${pendingOpen.name}`,
        };
      }

      const sceneData = await loadSceneFromPendingOpen(pendingOpen, libraryItems);
      return {
        initialData: sceneData,
        pageSettings: sceneData.pageSettings ?? DEFAULT_PAGE_SETTINGS,
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
        pageSettings: DEFAULT_PAGE_SETTINGS,
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
      pageSettings: DEFAULT_PAGE_SETTINGS,
      libraryItems,
      recents,
      settings,
    };
  }

  try {
    const sceneData = await loadSceneFromText(autosaveText, libraryItems);
    return {
      initialData: sceneData,
      pageSettings: sceneData.pageSettings ?? DEFAULT_PAGE_SETTINGS,
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
      pageSettings: DEFAULT_PAGE_SETTINGS,
      libraryItems,
      recents,
      settings,
      importNotice: "Autosave recovery was unavailable, starting fresh.",
    };
  }
};
