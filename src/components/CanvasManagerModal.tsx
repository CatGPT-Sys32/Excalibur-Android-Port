import { useMemo, useState } from "react";

import type {
  CanvasVersionMeta,
  SavedSceneFile,
} from "../lib/persistence";

type CanvasSortMode = "recent" | "name" | "size";

type CanvasManagerModalProps = {
  savedScenes: SavedSceneFile[];
  loading: boolean;
  activeTimelineScene: SavedSceneFile | null;
  versions: CanvasVersionMeta[];
  versionsLoading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onOpen: (savedScene: SavedSceneFile) => void;
  onRename: (savedScene: SavedSceneFile) => void;
  onDuplicate: (savedScene: SavedSceneFile) => void;
  onDelete: (savedScene: SavedSceneFile) => void;
  onTimeline: (savedScene: SavedSceneFile) => void;
  onRestoreVersion: (
    savedScene: SavedSceneFile,
    version: CanvasVersionMeta,
  ) => void;
};

const formatTimestamp = (mtime: number) => {
  if (!mtime) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(mtime));
};

const formatBytes = (bytes: number) => {
  if (!bytes) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const locationLabel = (savedScene: SavedSceneFile) => {
  if (savedScene.location === "documents") {
    return "Documents/Excalidraw/canvases";
  }
  if (savedScene.location === "external") {
    return "Legacy external storage";
  }
  return "App data";
};

export function CanvasManagerModal({
  activeTimelineScene,
  loading,
  onClose,
  onDelete,
  onDuplicate,
  onOpen,
  onRefresh,
  onRename,
  onRestoreVersion,
  onTimeline,
  savedScenes,
  versions,
  versionsLoading,
}: CanvasManagerModalProps) {
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<CanvasSortMode>("recent");

  const visibleScenes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filteredScenes = normalizedQuery
      ? savedScenes.filter((scene) =>
          scene.name.toLowerCase().includes(normalizedQuery),
        )
      : savedScenes;

    return [...filteredScenes].sort((first, second) => {
      if (sortMode === "name") {
        return first.name.localeCompare(second.name);
      }
      if (sortMode === "size") {
        return second.size - first.size || first.name.localeCompare(second.name);
      }
      return second.mtime - first.mtime || first.name.localeCompare(second.name);
    });
  }, [query, savedScenes, sortMode]);

  return (
    <div className="draw-directory-modal-backdrop" onClick={onClose}>
      <div
        className="draw-directory-modal draw-directory-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label="Canvas manager"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="draw-directory-modal-header">
          <div>
            <strong>Canvas Manager</strong>
            <p>Documents/Excalidraw/canvases</p>
          </div>
          <div className="draw-directory-header-actions">
            <button className="draw-directory-close" type="button" onClick={onRefresh}>
              Refresh
            </button>
            <button className="draw-directory-close" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="draw-directory-toolbar">
          <input
            aria-label="Search canvases"
            className="draw-directory-search"
            placeholder="Search canvases"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label="Sort canvases"
            className="draw-directory-select"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as CanvasSortMode)}
          >
            <option value="recent">Recent</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>
        </div>

        <div
          className={`draw-directory-modal-body draw-directory-modal-body--manager ${
            activeTimelineScene
              ? "draw-directory-modal-body--with-timeline"
              : ""
          }`}
        >
          <div className="draw-directory-list">
            {loading ? (
              <p className="draw-directory-empty">Loading saved scenes...</p>
            ) : visibleScenes.length === 0 ? (
              <p className="draw-directory-empty">
                No saved `.excalidraw` scenes found yet.
              </p>
            ) : (
              visibleScenes.map((savedScene) => (
                <div
                  key={`${savedScene.location}:${savedScene.path}`}
                  className="draw-directory-entry draw-directory-entry--canvas"
                >
                  <button
                    className="draw-directory-entry-main"
                    type="button"
                    onClick={() => onOpen(savedScene)}
                  >
                    <span className="draw-directory-thumbnail" aria-hidden="true">
                      {savedScene.thumbnailUri ? (
                        <img src={savedScene.thumbnailUri} alt="" />
                      ) : (
                        <span>{savedScene.name.slice(0, 1).toUpperCase()}</span>
                      )}
                    </span>
                    <span className="draw-directory-entry-text">
                      <span className="draw-menu-button-label">{savedScene.name}</span>
                      <span className="draw-menu-button-meta">
                        {formatTimestamp(savedScene.mtime)} - {formatBytes(savedScene.size)} -{" "}
                        {locationLabel(savedScene)}
                      </span>
                    </span>
                  </button>
                  <span className="draw-directory-entry-actions">
                    <button type="button" onClick={() => onTimeline(savedScene)}>
                      Timeline
                    </button>
                    <button type="button" onClick={() => onRename(savedScene)}>
                      Rename
                    </button>
                    <button type="button" onClick={() => onDuplicate(savedScene)}>
                      Duplicate
                    </button>
                    <button
                      className="draw-directory-danger-action"
                      type="button"
                      onClick={() => onDelete(savedScene)}
                    >
                      Delete
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>

          {activeTimelineScene ? (
            <div className="draw-directory-timeline">
              <div className="draw-directory-timeline-header">
                <strong>Timeline</strong>
                <span>{activeTimelineScene.name}</span>
              </div>
              {versionsLoading ? (
                <p className="draw-directory-empty">Loading versions...</p>
              ) : versions.length === 0 ? (
                <p className="draw-directory-empty">
                  No versions saved for this canvas yet.
                </p>
              ) : (
                versions.map((version) => (
                  <button
                    key={version.id}
                    className="draw-directory-version"
                    type="button"
                    onClick={() => onRestoreVersion(activeTimelineScene, version)}
                  >
                    <span>{formatTimestamp(new Date(version.createdAt).getTime())}</span>
                    <span className="draw-menu-button-meta">
                      {version.elementCount} elements - {formatBytes(version.size)}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
