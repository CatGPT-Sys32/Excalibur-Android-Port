import {
  PAGE_CANVAS_MODE_OPTIONS,
  PAGE_MARGIN_MODE_OPTIONS,
  PAGE_TEMPLATE_OPTIONS,
  getPageCanvasModeOption,
  getPageMarginModeOption,
  getPageTemplateOption,
  type PageCanvasMode,
  type PageMarginMode,
  type PageSettings,
  type PageTemplateId,
} from "../lib/pageSettings";

type PageSettingsModalProps = {
  pageSettings: PageSettings;
  onClose: () => void;
  onChange: (pageSettings: PageSettings) => void;
};

export function PageSettingsModal({
  onChange,
  onClose,
  pageSettings,
}: PageSettingsModalProps) {
  const currentTemplate = getPageTemplateOption(pageSettings.template);
  const currentMode = getPageCanvasModeOption(pageSettings.mode);
  const currentMarginMode = getPageMarginModeOption(pageSettings.marginMode);

  const updateMode = (mode: PageCanvasMode) => {
    const switchingToA4 = mode === "a4-vertical" && pageSettings.mode !== mode;
    const template =
      mode === "a4-vertical" && pageSettings.template === "off"
        ? "blank-a4"
        : mode === "infinite" && pageSettings.template === "blank-a4"
        ? "off"
        : pageSettings.template;

    onChange({
      ...pageSettings,
      mode,
      marginMode:
        mode === "a4-vertical"
          ? switchingToA4
            ? "locked"
            : pageSettings.marginMode
          : "writable",
      template,
    });
  };

  const updateTemplate = (template: PageTemplateId) => {
    const mode =
      template === "blank-a4" && pageSettings.mode === "infinite"
        ? "a4-vertical"
        : pageSettings.mode;

    onChange({
      ...pageSettings,
      mode,
      marginMode:
        pageSettings.mode === "infinite" && mode === "a4-vertical"
          ? "locked"
          : mode === "a4-vertical"
          ? pageSettings.marginMode
          : "writable",
      template,
    });
  };

  const updateMarginMode = (marginMode: PageMarginMode) => {
    onChange({
      ...pageSettings,
      marginMode,
    });
  };

  return (
    <div className="draw-directory-modal-backdrop" onClick={onClose}>
      <div
        className="draw-directory-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Page settings"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="draw-directory-modal-header">
          <div>
            <strong>Page Settings</strong>
            <p>
              {currentMode.name} · {currentTemplate.name}
              {currentMode.id === "a4-vertical"
                ? ` · ${currentMarginMode.name}`
                : ""}
            </p>
          </div>
          <button className="draw-directory-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="draw-directory-modal-body">
          <div className="draw-page-settings-group">
            <div className="draw-menu-section-title">Canvas mode</div>
            <div className="draw-page-mode-toggle" role="group" aria-label="Canvas mode">
              {PAGE_CANVAS_MODE_OPTIONS.map((mode) => {
                const selected = mode.id === currentMode.id;

                return (
                  <button
                    key={mode.id}
                    className="draw-page-mode-option"
                    type="button"
                    aria-pressed={selected}
                    onClick={() => updateMode(mode.id)}
                  >
                    <span className="draw-menu-button-label">{mode.name}</span>
                    <span className="draw-menu-button-meta">{mode.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {currentMode.id === "a4-vertical" ? (
            <div className="draw-page-settings-group">
              <div className="draw-menu-section-title">A4 margins</div>
              <div
                className="draw-page-mode-toggle"
                role="group"
                aria-label="A4 margins"
              >
                {PAGE_MARGIN_MODE_OPTIONS.map((marginMode) => {
                  const selected = marginMode.id === currentMarginMode.id;

                  return (
                    <button
                      key={marginMode.id}
                      className="draw-page-mode-option"
                      type="button"
                      aria-pressed={selected}
                      onClick={() => updateMarginMode(marginMode.id)}
                    >
                      <span className="draw-menu-button-label">
                        {marginMode.name}
                      </span>
                      <span className="draw-menu-button-meta">
                        {marginMode.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="draw-menu-section-title">Template</div>
          {PAGE_TEMPLATE_OPTIONS.map((template) => {
            const selected = template.id === currentTemplate.id;

            return (
              <button
                key={template.id}
                className="draw-directory-entry draw-directory-entry--template"
                type="button"
                aria-pressed={selected}
                onClick={() => updateTemplate(template.id)}
              >
                <span className="draw-directory-entry-text">
                  <span className="draw-menu-button-label">{template.name}</span>
                  <span className="draw-menu-button-meta">
                    {template.description}
                  </span>
                </span>
                {selected ? <span className="draw-menu-badge">Selected</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
