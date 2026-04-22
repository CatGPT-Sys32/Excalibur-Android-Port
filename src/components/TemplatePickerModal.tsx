import type { CanvasTemplate } from "../lib/templates";
import type { CustomCanvasTemplate } from "../lib/persistence";

type TemplatePickerModalProps = {
  templates: readonly CanvasTemplate[];
  customTemplates: readonly CustomCanvasTemplate[];
  onClose: () => void;
  onSelect: (template: CanvasTemplate | CustomCanvasTemplate) => void;
  onRenameCustom: (template: CustomCanvasTemplate) => void;
  onDeleteCustom: (template: CustomCanvasTemplate) => void;
};

export function TemplatePickerModal({
  customTemplates,
  onClose,
  onDeleteCustom,
  onRenameCustom,
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
          <div className="draw-directory-section-label">Bundled</div>
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

          <div className="draw-directory-section-label">Custom</div>
          {customTemplates.length === 0 ? (
            <p className="draw-directory-empty">No custom templates saved yet.</p>
          ) : (
            customTemplates.map((template) => (
              <div
                key={template.id}
                className="draw-directory-entry draw-directory-entry--canvas"
              >
                <button
                  className="draw-directory-entry-main"
                  type="button"
                  onClick={() => onSelect(template)}
                >
                  <span className="draw-directory-entry-text">
                    <span className="draw-menu-button-label">
                      {template.name}
                    </span>
                    <span className="draw-menu-button-meta">
                      {template.description}
                    </span>
                  </span>
                </button>
                <span className="draw-directory-entry-actions">
                  <button type="button" onClick={() => onRenameCustom(template)}>
                    Rename
                  </button>
                  <button
                    className="draw-directory-danger-action"
                    type="button"
                    onClick={() => onDeleteCustom(template)}
                  >
                    Delete
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
