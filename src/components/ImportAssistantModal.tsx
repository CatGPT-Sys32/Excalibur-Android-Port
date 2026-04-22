import type { ImportPlan } from "../lib/imports";

type ImportAssistantModalProps = {
  plan: ImportPlan;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

const fileCount = (count: number, label: string) =>
  `${count} ${label}${count === 1 ? "" : "s"}`;

export function ImportAssistantModal({
  busy,
  onClose,
  onConfirm,
  plan,
}: ImportAssistantModalProps) {
  const supportedCount =
    plan.scenes.length + plan.libraries.length + plan.images.length;
  const skippedCount = plan.unsupported.length + plan.oversized.length;

  return (
    <div className="draw-directory-modal-backdrop" onClick={onClose}>
      <div
        className="draw-directory-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Import assistant"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="draw-directory-modal-header">
          <div>
            <strong>Import Assistant</strong>
            <p>
              {fileCount(supportedCount, "supported file")}
              {skippedCount ? ` · ${fileCount(skippedCount, "skipped file")}` : ""}
            </p>
          </div>
          <button className="draw-directory-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="draw-directory-modal-body">
          <div className="draw-import-summary">
            <div>
              <span>Canvases</span>
              <strong>{plan.scenes.length}</strong>
            </div>
            <div>
              <span>Libraries</span>
              <strong>{plan.libraries.length}</strong>
            </div>
            <div>
              <span>Images</span>
              <strong>{plan.images.length}</strong>
            </div>
            <div>
              <span>Unsupported</span>
              <strong>{plan.unsupported.length}</strong>
            </div>
            <div>
              <span>Oversized</span>
              <strong>{plan.oversized.length}</strong>
            </div>
          </div>

          {skippedCount ? (
            <div className="draw-directory-note">
              Unsupported or oversized files will be skipped.
            </div>
          ) : null}

          <div className="draw-directory-header-actions draw-directory-footer-actions">
            <button
              className="draw-directory-close"
              disabled={busy}
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="draw-directory-close draw-directory-primary-action"
              disabled={busy || supportedCount === 0}
              type="button"
              onClick={onConfirm}
            >
              {busy ? "Importing..." : "Import supported files"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
