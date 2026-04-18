import { MainMenu } from "@excalidraw/excalidraw";
import type { Theme } from "@excalidraw/excalidraw/element/types";

import type { NativeStylusSnapshot } from "../lib/androidBridge";
import {
  getPageCanvasModeOption,
  getPageTemplateOption,
  type PageSettings,
} from "../lib/pageSettings";
import type { DrawSettings } from "../lib/persistence";

type DrawMainMenuProps = {
  openCanvas: () => void;
  openFiles: () => void;
  openDirectory: () => void;
  openTemplates: () => void;
  openPageSettings: () => void;
  openBackupCenter: () => void;
  saveSceneCopy: () => Promise<void>;
  shareSceneCopy: () => Promise<void>;
  exportLibrary: () => Promise<void>;
  exportPdf: () => Promise<void>;
  exportPng: () => Promise<void>;
  exportSvg: () => Promise<void>;
  restoreLatestAutosave: () => Promise<void>;
  theme: Theme;
  pageSettings: PageSettings;
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

const onOffLabel = (enabled: boolean) => (enabled ? "On" : "Off");

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

export function DrawMainMenu(props: DrawMainMenuProps) {
  const menuButtonClassName = "draw-menu-button dropdown-menu-item dropdown-menu-item-base";

  return (
    <MainMenu>
      <MainMenu.DefaultItems.CommandPalette />
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.Separator />
      <MainMenu.ItemCustom>
        <div className="draw-menu-section-title">File Actions</div>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className={menuButtonClassName} type="button" onClick={props.openDirectory}>
          <span className="draw-menu-button-label">Open Directory</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className={menuButtonClassName} type="button" onClick={props.openFiles}>
          <span className="draw-menu-button-label">Import files</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className={menuButtonClassName} type="button" onClick={props.saveSceneCopy}>
          <span className="draw-menu-button-label">Save to device</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className={menuButtonClassName} type="button" onClick={props.openTemplates}>
          <span className="draw-menu-button-label">New from Template</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <div className="draw-menu-section-title">Page Settings</div>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button
          className={menuButtonClassName}
          type="button"
          onClick={props.openPageSettings}
        >
          <span className="draw-menu-button-label">Page template</span>
          <span className="draw-menu-badge">
            {getPageTemplateOption(props.pageSettings.template).name} ·{" "}
            {getPageCanvasModeOption(props.pageSettings.mode).name}
          </span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className={menuButtonClassName} type="button" onClick={props.exportPdf}>
          <span className="draw-menu-button-label">Export A4 PDF to device</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className={menuButtonClassName} type="button" onClick={props.shareSceneCopy}>
          <span className="draw-menu-button-label">Share current scene</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className={menuButtonClassName} type="button" onClick={props.exportPng}>
          <span className="draw-menu-button-label">Export PNG to device</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className={menuButtonClassName} type="button" onClick={props.exportSvg}>
          <span className="draw-menu-button-label">Export SVG to device</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button className={menuButtonClassName} type="button" onClick={props.openCanvas}>
          <span className="draw-menu-button-label">Open Canvas</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button
          className={menuButtonClassName}
          type="button"
          onClick={props.openBackupCenter}
        >
          <span className="draw-menu-button-label">Backup Center</span>
        </button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom>
        <button
          className={menuButtonClassName}
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
        <button className={menuButtonClassName} type="button" onClick={props.toggleTheme}>
          <span className="draw-menu-button-label">Dark mode</span>
          <span className="draw-menu-badge">{onOffLabel(props.theme === "dark")}</span>
        </button>
      </MainMenu.ItemCustom>

      <MainMenu.ItemCustom>
        <button className={menuButtonClassName} type="button" onClick={props.toggleZenMode}>
          <span className="draw-menu-button-label">Zen canvas mode</span>
          <span className="draw-menu-badge">{onOffLabel(props.zenModeEnabled)}</span>
        </button>
      </MainMenu.ItemCustom>

      <MainMenu.ItemCustom>
        <button className={menuButtonClassName} type="button" onClick={props.toggleViewMode}>
          <span className="draw-menu-button-label">View-only mode</span>
          <span className="draw-menu-badge">{onOffLabel(props.viewModeEnabled)}</span>
        </button>
      </MainMenu.ItemCustom>

      <MainMenu.ItemCustom>
        <button className={menuButtonClassName} type="button" onClick={props.toggleGridMode}>
          <span className="draw-menu-button-label">Grid overlay</span>
          <span className="draw-menu-badge">{onOffLabel(props.gridModeEnabled)}</span>
        </button>
      </MainMenu.ItemCustom>

      <MainMenu.ItemCustom>
        <button className={menuButtonClassName} type="button" onClick={props.toggleSnapMode}>
          <span className="draw-menu-button-label">Object snap</span>
          <span className="draw-menu-badge">
            {onOffLabel(props.objectsSnapModeEnabled)}
          </span>
        </button>
      </MainMenu.ItemCustom>

      <MainMenu.ItemCustom>
        <button
          className={menuButtonClassName}
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
          className={menuButtonClassName}
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
