import type { CanvasTemplate } from "../lib/templates";

type TemplatePickerModalProps = {
  templates: readonly CanvasTemplate[];
  onClose: () => void;
  onSelect: (template: CanvasTemplate) => void;
};

export function TemplatePickerModal({
  onClose,
  onSelect,
  templates,
}: TemplatePickerModalProps) {
  return (
    <div className="draw-directory-modal-backdrop" onClick={onClose}>
      <div
        className="draw-directory-modal"
        role="dialog"
        aria-modal="true"
        aria-label="New from template"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="draw-directory-modal-header">
          <div>
            <strong>New from Template</strong>
            <p>Bundled local templates</p>
          </div>
          <button className="draw-directory-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="draw-directory-modal-body">
          {templates.map((template) => (
            <button
              key={template.id}
              className="draw-directory-entry draw-directory-entry--template"
              type="button"
              onClick={() => onSelect(template)}
            >
              <span className="draw-directory-entry-text">
                <span className="draw-menu-button-label">{template.name}</span>
                <span className="draw-menu-button-meta">
                  {template.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
