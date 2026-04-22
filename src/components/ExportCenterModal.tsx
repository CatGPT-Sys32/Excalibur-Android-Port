import { useState } from "react";

import type { ExportFormat } from "../lib/exports";

type ExportCenterModalProps = {
  busy: boolean;
  onClose: () => void;
  onExport: (formats: ExportFormat[]) => void;
};

const EXPORT_OPTIONS: Array<{
  format: ExportFormat;
  label: string;
  description: string;
}> = [
  {
    format: "excalidraw",
    label: "Scene file",
    description: "Editable .excalidraw copy",
  },
  {
    format: "png",
    label: "PNG",
    description: "Raster image export",
  },
  {
    format: "svg",
    label: "SVG",
    description: "Vector image export",
  },
  {
    format: "pdf",
    label: "A4 PDF",
    description: "Portrait A4 pages",
  },
];

export function ExportCenterModal({
  busy,
  onClose,
  onExport,
}: ExportCenterModalProps) {
  const [formats, setFormats] = useState<Set<ExportFormat>>(
    () => new Set(["excalidraw", "png", "svg", "pdf"]),
  );

  const toggleFormat = (format: ExportFormat) => {
    setFormats((currentFormats) => {
      const nextFormats = new Set(currentFormats);
      if (nextFormats.has(format)) {
        nextFormats.delete(format);
      } else {
        nextFormats.add(format);
      }
      return nextFormats;
    });
  };

  return (
    <div className="draw-directory-modal-backdrop" onClick={onClose}>
      <div
        className="draw-directory-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Export center"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="draw-directory-modal-header">
          <div>
            <strong>Export Center</strong>
            <p>Documents/Excalidraw/exports</p>
          </div>
          <button className="draw-directory-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="draw-directory-modal-body">
          {EXPORT_OPTIONS.map((option) => (
            <label
              key={option.format}
              className="draw-directory-entry draw-directory-entry--template draw-export-option"
            >
              <input
                checked={formats.has(option.format)}
                disabled={busy}
                type="checkbox"
                onChange={() => toggleFormat(option.format)}
              />
              <span className="draw-directory-entry-text">
                <span className="draw-menu-button-label">{option.label}</span>
                <span className="draw-menu-button-meta">
                  {option.description}
                </span>
              </span>
            </label>
          ))}

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
              disabled={busy || formats.size === 0}
              type="button"
              onClick={() => onExport([...formats])}
            >
              {busy ? "Exporting..." : "Export selected"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
