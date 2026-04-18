import { MIME_TYPES } from "@excalidraw/common";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeleted,
} from "@excalidraw/element/types";

import type { AppState, BinaryFiles } from "../types";

import { copyBlobToClipboardAsPng, copyTextToSystemClipboard } from "../clipboard";
import { canvasToBlob } from "../data/blob";
import { serializeAsJSON } from "../data/json";
import { exportToCanvas as exportSceneToCanvas, exportToSvg as exportSceneToSvg } from "../scene/export";
import { getDefaultAppState } from "../appState";

export { MIME_TYPES };

type ExportOpts = {
  elements: readonly NonDeleted<ExcalidrawElement>[];
  appState?: Partial<Omit<AppState, "offsetTop" | "offsetLeft">>;
  files: BinaryFiles | null;
  maxWidthOrHeight?: number;
  exportingFrame?: ExcalidrawFrameLikeElement | null;
  getDimensions?: (width: number, height: number) => {
    width: number;
    height: number;
    scale?: number;
  };
};

const toAppState = (
  appState?: Partial<Omit<AppState, "offsetTop" | "offsetLeft">>,
): AppState => {
  const defaults = getDefaultAppState();

  return {
    ...defaults,
    offsetTop: 0,
    offsetLeft: 0,
    width: 0,
    height: 0,
    ...appState,
  } as AppState;
};

const maybeRescaleCanvas = (
  canvas: HTMLCanvasElement,
  maxWidthOrHeight?: number,
  getDimensions?: (width: number, height: number) => {
    width: number;
    height: number;
    scale?: number;
  },
) => {
  let targetWidth = canvas.width;
  let targetHeight = canvas.height;

  if (maxWidthOrHeight && Math.max(targetWidth, targetHeight) > maxWidthOrHeight) {
    const scale = maxWidthOrHeight / Math.max(targetWidth, targetHeight);
    targetWidth = Math.max(1, Math.round(targetWidth * scale));
    targetHeight = Math.max(1, Math.round(targetHeight * scale));
  }

  if (getDimensions) {
    const dimensions = getDimensions(targetWidth, targetHeight);
    const scale = dimensions.scale ?? 1;
    targetWidth = Math.max(1, Math.round(dimensions.width * scale));
    targetHeight = Math.max(1, Math.round(dimensions.height * scale));
  }

  if (targetWidth === canvas.width && targetHeight === canvas.height) {
    return canvas;
  }

  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = targetWidth;
  scaledCanvas.height = targetHeight;

  const context = scaledCanvas.getContext("2d");
  if (context) {
    context.drawImage(canvas, 0, 0, targetWidth, targetHeight);
  }

  return scaledCanvas;
};

export const exportToCanvas = async ({
  elements,
  appState,
  files,
  maxWidthOrHeight,
  getDimensions,
  exportingFrame,
}: ExportOpts & {
  exportPadding?: number;
}) => {
  const resolvedAppState = toAppState(appState);

  const canvas = await exportSceneToCanvas(
    elements,
    resolvedAppState,
    files || {},
    {
      exportBackground: resolvedAppState.exportBackground,
      viewBackgroundColor: resolvedAppState.viewBackgroundColor,
      exportingFrame: exportingFrame ?? null,
    },
  );

  return maybeRescaleCanvas(canvas, maxWidthOrHeight, getDimensions);
};

export const exportToBlob = async (
  opts: ExportOpts & {
    mimeType?: string;
    quality?: number;
    exportPadding?: number;
  },
): Promise<Blob> => {
  const canvas = await exportToCanvas(opts);

  if (!opts.mimeType || opts.mimeType === MIME_TYPES.png) {
    return canvasToBlob(canvas);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not export canvas to blob"));
          return;
        }
        resolve(blob);
      },
      opts.mimeType,
      opts.quality,
    );
  });
};

export const exportToSvg = async ({
  elements,
  appState,
  files,
  exportPadding,
  renderEmbeddables,
  exportingFrame,
  skipInliningFonts,
  reuseImages,
}: Omit<ExportOpts, "getDimensions"> & {
  exportPadding?: number;
  renderEmbeddables?: boolean;
  skipInliningFonts?: true;
  reuseImages?: boolean;
}) => {
  const resolvedAppState = toAppState(appState);

  return exportSceneToSvg(
    elements,
    {
      exportBackground: resolvedAppState.exportBackground,
      exportPadding,
      exportScale: resolvedAppState.exportScale,
      viewBackgroundColor: resolvedAppState.viewBackgroundColor,
      exportWithDarkMode: resolvedAppState.exportWithDarkMode,
      exportEmbedScene: resolvedAppState.exportEmbedScene,
      frameRendering: resolvedAppState.frameRendering,
    },
    files,
    {
      renderEmbeddables,
      exportingFrame,
      skipInliningFonts,
      reuseImages,
    },
  );
};

export const exportToClipboard = async (
  opts: ExportOpts & {
    mimeType?: string;
    quality?: number;
    type: "png" | "svg" | "json";
  },
): Promise<void> => {
  if (opts.type === "svg") {
    const svg = await exportToSvg(opts);
    await copyTextToSystemClipboard(svg.outerHTML);
    return;
  }

  if (opts.type === "json") {
    const appState = toAppState(opts.appState);
    await copyTextToSystemClipboard(
      serializeAsJSON(opts.elements, appState, opts.files || {}, "local"),
    );
    return;
  }

  const pngBlob = await exportToBlob({
    ...opts,
    mimeType: MIME_TYPES.png,
  });
  await copyBlobToClipboardAsPng(pngBlob);
};
