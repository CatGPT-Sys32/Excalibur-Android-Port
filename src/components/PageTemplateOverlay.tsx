import type { ReactNode } from "react";

import {
  A4_PAGE_SIZE,
  isPageTemplateEnabled,
  type PageSettings,
  type PageViewport,
} from "../lib/pageSettings";

type PageTile = {
  key: string;
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type PageTemplateOverlayProps = {
  pageSettings: PageSettings;
  viewport: PageViewport | null;
};

const MAX_VISIBLE_PAGES = 160;
const GUIDE_SPACING = 32;
const STAFF_GROUP_SPACING = 104;
const STAFF_LINE_SPACING = 10;

const screenPoint = (sceneCoordinate: number, scroll: number, zoom: number) =>
  (sceneCoordinate + scroll) * zoom;

const buildA4VerticalTiles = (viewport: PageViewport) => {
  const zoom = Math.max(0.01, viewport.zoom || 1);
  const sceneTop = -viewport.scrollY;
  const sceneBottom = sceneTop + viewport.height / zoom;
  const startRow = Math.floor(sceneTop / A4_PAGE_SIZE.height) - 1;
  const endRow = Math.ceil(sceneBottom / A4_PAGE_SIZE.height) + 1;
  const tiles: PageTile[] = [];

  for (let row = startRow; row <= endRow; row += 1) {
    if (tiles.length >= MAX_VISIBLE_PAGES) {
      return tiles;
    }

    const sceneY = row * A4_PAGE_SIZE.height;

    tiles.push({
      key: `${row}:0`,
      row,
      column: 0,
      x: screenPoint(0, viewport.scrollX, zoom),
      y: screenPoint(sceneY, viewport.scrollY, zoom),
      width: A4_PAGE_SIZE.width * zoom,
      height: A4_PAGE_SIZE.height * zoom,
    });
  }

  return tiles;
};

const renderGuideLines = (tile: PageTile, vertical: boolean) => {
  const step = GUIDE_SPACING * (vertical ? tile.width / A4_PAGE_SIZE.width : tile.height / A4_PAGE_SIZE.height);
  if (step < 5) {
    return null;
  }

  const lines: ReactNode[] = [];
  const limit = vertical ? tile.width : tile.height;

  for (let offset = step; offset < limit; offset += step) {
    const x = vertical ? tile.x + offset : tile.x;
    const y = vertical ? tile.y : tile.y + offset;
    lines.push(
      <line
        key={`${vertical ? "v" : "h"}-${Math.round(offset)}`}
        className="draw-page-overlay-guide"
        x1={x}
        y1={y}
        x2={vertical ? x : tile.x + tile.width}
        y2={vertical ? tile.y + tile.height : y}
      />,
    );
  }

  return lines;
};

const renderDots = (tile: PageTile) => {
  const step = GUIDE_SPACING * (tile.width / A4_PAGE_SIZE.width);
  if (step < 8) {
    return null;
  }

  const dots: ReactNode[] = [];
  const radius = Math.min(1.35, Math.max(0.65, step / 18));

  for (let y = tile.y + step; y < tile.y + tile.height; y += step) {
    for (let x = tile.x + step; x < tile.x + tile.width; x += step) {
      dots.push(
        <circle
          key={`${Math.round(x)}:${Math.round(y)}`}
          className="draw-page-overlay-dot"
          cx={x}
          cy={y}
          r={radius}
        />,
      );
    }
  }

  return dots;
};

const renderIsometric = (tile: PageTile) => {
  const step = GUIDE_SPACING * (tile.width / A4_PAGE_SIZE.width);
  if (step < 7) {
    return null;
  }

  const lines: ReactNode[] = [];
  const minOffset = -tile.height;
  const maxOffset = tile.width + tile.height;

  for (let offset = minOffset; offset < maxOffset; offset += step) {
    lines.push(
      <line
        key={`down-${Math.round(offset)}`}
        className="draw-page-overlay-guide"
        x1={tile.x + offset}
        y1={tile.y}
        x2={tile.x + offset + tile.height}
        y2={tile.y + tile.height}
      />,
      <line
        key={`up-${Math.round(offset)}`}
        className="draw-page-overlay-guide"
        x1={tile.x + offset}
        y1={tile.y + tile.height}
        x2={tile.x + offset + tile.height}
        y2={tile.y}
      />,
    );
  }

  return lines;
};

const renderMusicStaff = (tile: PageTile) => {
  const groupStep = STAFF_GROUP_SPACING * (tile.height / A4_PAGE_SIZE.height);
  const lineStep = STAFF_LINE_SPACING * (tile.height / A4_PAGE_SIZE.height);
  if (lineStep < 3) {
    return null;
  }

  const lines: ReactNode[] = [];

  for (
    let groupY = tile.y + groupStep * 0.55;
    groupY < tile.y + tile.height;
    groupY += groupStep
  ) {
    for (let lineIndex = 0; lineIndex < 5; lineIndex += 1) {
      const y = groupY + lineIndex * lineStep;
      lines.push(
        <line
          key={`${Math.round(groupY)}-${lineIndex}`}
          className="draw-page-overlay-guide"
          x1={tile.x}
          y1={y}
          x2={tile.x + tile.width}
          y2={y}
        />,
      );
    }
  }

  return lines;
};

const renderTemplate = (tile: PageTile, pageSettings: PageSettings) => {
  switch (pageSettings.template) {
    case "lined":
      return renderGuideLines(tile, false);
    case "grid":
      return [renderGuideLines(tile, false), renderGuideLines(tile, true)];
    case "dotted":
      return renderDots(tile);
    case "isometric":
      return renderIsometric(tile);
    case "music":
      return renderMusicStaff(tile);
    case "blank-a4":
    case "off":
      return null;
  }
};

const getVisibleSceneBounds = (viewport: PageViewport) => {
  const zoom = Math.max(0.01, viewport.zoom || 1);
  const sceneLeft = -viewport.scrollX;
  const sceneTop = -viewport.scrollY;
  const sceneRight = sceneLeft + viewport.width / zoom;
  const sceneBottom = sceneTop + viewport.height / zoom;

  return {
    zoom,
    sceneLeft,
    sceneTop,
    sceneRight,
    sceneBottom,
  };
};

const renderInfiniteGuideLines = (viewport: PageViewport, vertical: boolean) => {
  const { zoom, sceneLeft, sceneTop, sceneRight, sceneBottom } =
    getVisibleSceneBounds(viewport);
  const step = GUIDE_SPACING * zoom;
  if (step < 5) {
    return null;
  }

  const lines: ReactNode[] = [];
  const startSceneCoordinate =
    Math.floor((vertical ? sceneLeft : sceneTop) / GUIDE_SPACING) *
    GUIDE_SPACING;
  const endSceneCoordinate = vertical ? sceneRight : sceneBottom;

  for (
    let sceneCoordinate = startSceneCoordinate;
    sceneCoordinate <= endSceneCoordinate;
    sceneCoordinate += GUIDE_SPACING
  ) {
    const x = vertical
      ? screenPoint(sceneCoordinate, viewport.scrollX, zoom)
      : 0;
    const y = vertical
      ? 0
      : screenPoint(sceneCoordinate, viewport.scrollY, zoom);

    lines.push(
      <line
        key={`${vertical ? "v" : "h"}-${sceneCoordinate}`}
        className="draw-page-overlay-guide"
        x1={x}
        y1={y}
        x2={vertical ? x : viewport.width}
        y2={vertical ? viewport.height : y}
      />,
    );
  }

  return lines;
};

const renderInfiniteDots = (viewport: PageViewport) => {
  const { zoom, sceneLeft, sceneTop, sceneRight, sceneBottom } =
    getVisibleSceneBounds(viewport);
  const step = GUIDE_SPACING * zoom;
  if (step < 8) {
    return null;
  }

  const dots: ReactNode[] = [];
  const radius = Math.min(1.35, Math.max(0.65, step / 18));
  const startSceneX = Math.floor(sceneLeft / GUIDE_SPACING) * GUIDE_SPACING;
  const startSceneY = Math.floor(sceneTop / GUIDE_SPACING) * GUIDE_SPACING;

  for (let sceneY = startSceneY; sceneY <= sceneBottom; sceneY += GUIDE_SPACING) {
    for (let sceneX = startSceneX; sceneX <= sceneRight; sceneX += GUIDE_SPACING) {
      dots.push(
        <circle
          key={`${sceneX}:${sceneY}`}
          className="draw-page-overlay-dot"
          cx={screenPoint(sceneX, viewport.scrollX, zoom)}
          cy={screenPoint(sceneY, viewport.scrollY, zoom)}
          r={radius}
        />,
      );
    }
  }

  return dots;
};

const renderInfiniteIsometric = (viewport: PageViewport) => {
  const { zoom, sceneLeft, sceneTop, sceneRight, sceneBottom } =
    getVisibleSceneBounds(viewport);
  const step = GUIDE_SPACING * zoom;
  if (step < 7) {
    return null;
  }

  const lines: ReactNode[] = [];
  const sceneHeight = sceneBottom - sceneTop;
  const startOffset =
    Math.floor((sceneLeft - sceneHeight) / GUIDE_SPACING) * GUIDE_SPACING;
  const endOffset = sceneRight + sceneHeight;

  for (let offset = startOffset; offset < endOffset; offset += GUIDE_SPACING) {
    lines.push(
      <line
        key={`down-${offset}`}
        className="draw-page-overlay-guide"
        x1={screenPoint(offset, viewport.scrollX, zoom)}
        y1={screenPoint(sceneTop, viewport.scrollY, zoom)}
        x2={screenPoint(offset + sceneHeight, viewport.scrollX, zoom)}
        y2={screenPoint(sceneBottom, viewport.scrollY, zoom)}
      />,
      <line
        key={`up-${offset}`}
        className="draw-page-overlay-guide"
        x1={screenPoint(offset, viewport.scrollX, zoom)}
        y1={screenPoint(sceneBottom, viewport.scrollY, zoom)}
        x2={screenPoint(offset + sceneHeight, viewport.scrollX, zoom)}
        y2={screenPoint(sceneTop, viewport.scrollY, zoom)}
      />,
    );
  }

  return lines;
};

const renderInfiniteMusicStaff = (viewport: PageViewport) => {
  const { zoom, sceneTop, sceneBottom } = getVisibleSceneBounds(viewport);
  const lineStep = STAFF_LINE_SPACING * zoom;
  if (lineStep < 3) {
    return null;
  }

  const lines: ReactNode[] = [];
  const startGroupSceneY =
    Math.floor(sceneTop / STAFF_GROUP_SPACING) * STAFF_GROUP_SPACING;

  for (
    let groupSceneY = startGroupSceneY;
    groupSceneY <= sceneBottom;
    groupSceneY += STAFF_GROUP_SPACING
  ) {
    for (let lineIndex = 0; lineIndex < 5; lineIndex += 1) {
      const y = screenPoint(
        groupSceneY + STAFF_GROUP_SPACING * 0.55 + lineIndex * STAFF_LINE_SPACING,
        viewport.scrollY,
        zoom,
      );
      lines.push(
        <line
          key={`${groupSceneY}-${lineIndex}`}
          className="draw-page-overlay-guide"
          x1={0}
          y1={y}
          x2={viewport.width}
          y2={y}
        />,
      );
    }
  }

  return lines;
};

const renderInfiniteTemplate = (
  viewport: PageViewport,
  pageSettings: PageSettings,
) => {
  switch (pageSettings.template) {
    case "lined":
      return renderInfiniteGuideLines(viewport, false);
    case "grid":
      return [
        renderInfiniteGuideLines(viewport, false),
        renderInfiniteGuideLines(viewport, true),
      ];
    case "dotted":
      return renderInfiniteDots(viewport);
    case "isometric":
      return renderInfiniteIsometric(viewport);
    case "music":
      return renderInfiniteMusicStaff(viewport);
    case "blank-a4":
    case "off":
      return null;
  }
};

export function PageTemplateOverlay({
  pageSettings,
  viewport,
}: PageTemplateOverlayProps) {
  if (!viewport || !isPageTemplateEnabled(pageSettings)) {
    return null;
  }

  return (
    <svg
      className="draw-page-overlay"
      width={viewport.width}
      height={viewport.height}
      aria-hidden="true"
    >
      {pageSettings.mode === "infinite" ? (
        renderInfiniteTemplate(viewport, pageSettings)
      ) : (
        <A4VerticalTemplate pageSettings={pageSettings} viewport={viewport} />
      )}
    </svg>
  );
}

function A4VerticalTemplate({
  pageSettings,
  viewport,
}: PageTemplateOverlayProps & { viewport: PageViewport }) {
  const tiles = buildA4VerticalTiles(viewport);

  return (
    <>
      <defs>
        {tiles.map((tile) => (
          <clipPath key={tile.key} id={`draw-page-clip-${tile.row}-${tile.column}`}>
            <rect x={tile.x} y={tile.y} width={tile.width} height={tile.height} />
          </clipPath>
        ))}
      </defs>

      {tiles.map((tile) => (
        <g key={tile.key}>
          <g clipPath={`url(#draw-page-clip-${tile.row}-${tile.column})`}>
            {renderTemplate(tile, pageSettings)}
          </g>
          <rect
            className="draw-page-overlay-border"
            x={tile.x}
            y={tile.y}
            width={tile.width}
            height={tile.height}
          />
        </g>
      ))}
    </>
  );
}
