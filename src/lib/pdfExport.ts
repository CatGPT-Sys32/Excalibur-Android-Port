import { getCommonBounds, newFrameElement } from "@excalidraw/element";

import {
  A4_PAGE_SIZE,
  A4_PAGE_SIZE_MM,
  type PageSettings,
} from "./pageSettings";

import type {
  AppState,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

type PdfScenePayload = {
  elements: readonly OrderedExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
};

type PdfPage = {
  column: number;
  row: number;
  x: number;
  y: number;
};

type PdfDocument = {
  addImage: (
    imageData: string,
    format: string,
    x: number,
    y: number,
    width: number,
    height: number,
    alias?: string,
    compression?: "NONE" | "FAST" | "MEDIUM" | "SLOW",
  ) => unknown;
  addPage: (
    format?: string,
    orientation?: "p" | "portrait" | "l" | "landscape",
  ) => unknown;
  circle: (x: number, y: number, radius: number, style?: string) => unknown;
  line: (x1: number, y1: number, x2: number, y2: number) => unknown;
  output: (type: "blob") => Blob;
  setDrawColor: (r: number, g: number, b: number) => unknown;
  setFillColor: (r: number, g: number, b: number) => unknown;
  setLineWidth: (width: number) => unknown;
  setProperties: (properties: {
    title?: string;
    creator?: string;
  }) => unknown;
};

const SCENE_LINE_SPACING = 32;
const STAFF_GROUP_SPACING = 104;
const STAFF_LINE_SPACING = 10;
const PAGE_EPSILON = 0.001;

const sceneXToPdf = (value: number) =>
  (value / A4_PAGE_SIZE.width) * A4_PAGE_SIZE_MM.width;

const sceneYToPdf = (value: number) =>
  (value / A4_PAGE_SIZE.height) * A4_PAGE_SIZE_MM.height;

const pageKey = (column: number, row: number) => `${column}:${row}`;

const getCurrentViewportPage = (
  appState: AppState,
  pageSettings: PageSettings,
): PdfPage => {
  const zoom = appState.zoom?.value || 1;
  const centerX = -appState.scrollX + appState.width / (2 * zoom);
  const centerY = -appState.scrollY + appState.height / (2 * zoom);
  const column =
    pageSettings.mode === "a4-vertical"
      ? 0
      : Math.floor(centerX / A4_PAGE_SIZE.width);
  const row = Math.floor(centerY / A4_PAGE_SIZE.height);

  return {
    column,
    row,
    x: column * A4_PAGE_SIZE.width,
    y: row * A4_PAGE_SIZE.height,
  };
};

const getOccupiedPages = (
  payload: PdfScenePayload,
  pageSettings: PageSettings,
) => {
  const pages = new Map<string, PdfPage>();

  for (const element of payload.elements) {
    if (element.isDeleted) {
      continue;
    }

    const [minX, minY, maxX, maxY] = getCommonBounds([element as never]);
    const startColumn = Math.floor(minX / A4_PAGE_SIZE.width);
    const endColumn = Math.floor((maxX - PAGE_EPSILON) / A4_PAGE_SIZE.width);
    const startRow = Math.floor(minY / A4_PAGE_SIZE.height);
    const endRow = Math.floor((maxY - PAGE_EPSILON) / A4_PAGE_SIZE.height);

    if (pageSettings.mode === "a4-vertical") {
      for (let row = startRow; row <= endRow; row += 1) {
        pages.set(pageKey(0, row), {
          column: 0,
          row,
          x: 0,
          y: row * A4_PAGE_SIZE.height,
        });
      }
      continue;
    }

    for (let row = startRow; row <= endRow; row += 1) {
      for (let column = startColumn; column <= endColumn; column += 1) {
        pages.set(pageKey(column, row), {
          column,
          row,
          x: column * A4_PAGE_SIZE.width,
          y: row * A4_PAGE_SIZE.height,
        });
      }
    }
  }

  if (pages.size === 0) {
    const page = getCurrentViewportPage(payload.appState, pageSettings);
    pages.set(pageKey(page.column, page.row), page);
  }

  return [...pages.values()].sort(
    (first, second) => first.row - second.row || first.column - second.column,
  );
};

const drawHorizontalLines = (pdf: PdfDocument) => {
  const spacing = sceneYToPdf(SCENE_LINE_SPACING);
  for (let y = spacing; y < A4_PAGE_SIZE_MM.height; y += spacing) {
    pdf.line(0, y, A4_PAGE_SIZE_MM.width, y);
  }
};

const drawVerticalLines = (pdf: PdfDocument) => {
  const spacing = sceneXToPdf(SCENE_LINE_SPACING);
  for (let x = spacing; x < A4_PAGE_SIZE_MM.width; x += spacing) {
    pdf.line(x, 0, x, A4_PAGE_SIZE_MM.height);
  }
};

const drawDots = (pdf: PdfDocument) => {
  const xSpacing = sceneXToPdf(SCENE_LINE_SPACING);
  const ySpacing = sceneYToPdf(SCENE_LINE_SPACING);
  const radius = 0.28;

  for (let y = ySpacing; y < A4_PAGE_SIZE_MM.height; y += ySpacing) {
    for (let x = xSpacing; x < A4_PAGE_SIZE_MM.width; x += xSpacing) {
      pdf.circle(x, y, radius, "F");
    }
  }
};

const drawIsometric = (pdf: PdfDocument) => {
  const spacing = sceneXToPdf(SCENE_LINE_SPACING);
  const maxOffset = A4_PAGE_SIZE_MM.width + A4_PAGE_SIZE_MM.height;

  for (let offset = -A4_PAGE_SIZE_MM.height; offset < maxOffset; offset += spacing) {
    pdf.line(offset, 0, offset + A4_PAGE_SIZE_MM.height, A4_PAGE_SIZE_MM.height);
    pdf.line(
      offset,
      A4_PAGE_SIZE_MM.height,
      offset + A4_PAGE_SIZE_MM.height,
      0,
    );
  }
};

const drawMusicStaff = (pdf: PdfDocument) => {
  const groupSpacing = sceneYToPdf(STAFF_GROUP_SPACING);
  const lineSpacing = sceneYToPdf(STAFF_LINE_SPACING);

  for (
    let groupY = groupSpacing * 0.55;
    groupY < A4_PAGE_SIZE_MM.height;
    groupY += groupSpacing
  ) {
    for (let lineIndex = 0; lineIndex < 5; lineIndex += 1) {
      const y = groupY + lineIndex * lineSpacing;
      pdf.line(0, y, A4_PAGE_SIZE_MM.width, y);
    }
  }
};

const drawPageTemplate = (pdf: PdfDocument, pageSettings: PageSettings) => {
  pdf.setDrawColor(210, 218, 230);
  pdf.setFillColor(186, 196, 214);
  pdf.setLineWidth(0.12);

  switch (pageSettings.template) {
    case "lined":
      drawHorizontalLines(pdf);
      break;
    case "grid":
      drawHorizontalLines(pdf);
      drawVerticalLines(pdf);
      break;
    case "dotted":
      drawDots(pdf);
      break;
    case "isometric":
      drawIsometric(pdf);
      break;
    case "music":
      drawMusicStaff(pdf);
      break;
    case "blank-a4":
    case "off":
      break;
  }
};

export const createA4PdfBlob = async (
  payload: PdfScenePayload,
  pageSettings: PageSettings,
) => {
  const [{ exportToCanvas }, { jsPDF }] = await Promise.all([
    import("@excalidraw/excalidraw"),
    import("jspdf"),
  ]);
  const pages = getOccupiedPages(payload, pageSettings);
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  pdf.setProperties({
    title: payload.appState.name || "Escalidraw scene",
    creator: "Escalidraw",
  });

  for (const [index, page] of pages.entries()) {
    if (index > 0) {
      pdf.addPage("a4", "portrait");
    }

    drawPageTemplate(pdf, pageSettings);

    if (payload.elements.length === 0) {
      continue;
    }

    const pageFrame = newFrameElement({
      x: page.x,
      y: page.y,
      width: A4_PAGE_SIZE.width,
      height: A4_PAGE_SIZE.height,
    });
    const canvas = await exportToCanvas({
      elements: payload.elements as never,
      appState: {
        ...payload.appState,
        exportBackground: false,
        exportScale: 2,
      },
      files: payload.files,
      exportingFrame: pageFrame as never,
    });

    pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      0,
      0,
      A4_PAGE_SIZE_MM.width,
      A4_PAGE_SIZE_MM.height,
      undefined,
      "FAST",
    );
  }

  return pdf.output("blob");
};
