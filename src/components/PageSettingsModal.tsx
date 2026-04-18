import {
  PAGE_CANVAS_MODE_OPTIONS,
  PAGE_TEMPLATE_OPTIONS,
  getPageCanvasModeOption,
  getPageTemplateOption,
  type PageCanvasMode,
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

  const updateMode = (mode: PageCanvasMode) => {
    const template =
      mode === "a4-vertical" && pageSettings.template === "off"
        ? "blank-a4"
        : mode === "infinite" && pageSettings.template === "blank-a4"
        ? "off"
        : pageSettings.template;

    onChange({
      ...pageSettings,
      mode,
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
      template,
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
            <p>{currentMode.name} · {currentTemplate.name}</p>
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
