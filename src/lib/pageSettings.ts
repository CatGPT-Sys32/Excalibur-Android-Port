export type PageTemplateId =
  | "off"
  | "blank-a4"
  | "lined"
  | "grid"
  | "dotted"
  | "isometric"
  | "music";

export type PageCanvasMode = "infinite" | "a4-vertical";

export type PageSettings = {
  template: PageTemplateId;
  mode: PageCanvasMode;
  orientation: "portrait";
  pageSize: "a4";
};

export type PageViewport = {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  zoom: number;
};

export type PageTemplateOption = {
  id: PageTemplateId;
  name: string;
  description: string;
};

export type PageCanvasModeOption = {
  id: PageCanvasMode;
  name: string;
  description: string;
};

export const PAGE_SETTINGS_METADATA_KEY = "escalidrawPageSettings";

export const A4_PAGE_SIZE = {
  width: 794,
  height: 1123,
} as const;

export const A4_PAGE_SIZE_MM = {
  width: 210,
  height: 297,
} as const;

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  template: "off",
  mode: "infinite",
  orientation: "portrait",
  pageSize: "a4",
};

export const PAGE_CANVAS_MODE_OPTIONS: readonly PageCanvasModeOption[] = [
  {
    id: "infinite",
    name: "Infinite canvas",
    description: "Patterns continue with the normal free canvas.",
  },
  {
    id: "a4-vertical",
    name: "A4 vertical",
    description: "Portrait pages stack in one vertical notes column.",
  },
] as const;

export const PAGE_TEMPLATE_OPTIONS: readonly PageTemplateOption[] = [
  {
    id: "off",
    name: "Off",
    description: "No page background.",
  },
  {
    id: "blank-a4",
    name: "Blank A4",
    description: "Portrait A4 page bounds only in A4 vertical mode.",
  },
  {
    id: "lined",
    name: "Lined",
    description: "Notebook lines on the active canvas mode.",
  },
  {
    id: "grid",
    name: "Grid",
    description: "Square grid on the active canvas mode.",
  },
  {
    id: "dotted",
    name: "Dotted",
    description: "Dot paper on the active canvas mode.",
  },
  {
    id: "isometric",
    name: "Isometric",
    description: "Angled construction guides on the active canvas mode.",
  },
  {
    id: "music",
    name: "Music staff",
    description: "Repeated five-line staffs on the active canvas mode.",
  },
] as const;

const PAGE_TEMPLATE_IDS = new Set<PageTemplateId>(
  PAGE_TEMPLATE_OPTIONS.map((option) => option.id),
);

const PAGE_CANVAS_MODES = new Set<PageCanvasMode>(
  PAGE_CANVAS_MODE_OPTIONS.map((option) => option.id),
);

export const getPageTemplateOption = (id: PageTemplateId) =>
  PAGE_TEMPLATE_OPTIONS.find((option) => option.id === id) ??
  PAGE_TEMPLATE_OPTIONS[0];

export const getPageCanvasModeOption = (id: PageCanvasMode) =>
  PAGE_CANVAS_MODE_OPTIONS.find((option) => option.id === id) ??
  PAGE_CANVAS_MODE_OPTIONS[0];

export const isPageTemplateEnabled = (pageSettings: PageSettings) =>
  pageSettings.template !== "off";

export const normalizePageSettings = (value: unknown): PageSettings => {
  if (!value || typeof value !== "object") {
    return DEFAULT_PAGE_SETTINGS;
  }

  const template = (value as Partial<PageSettings>).template;
  if (!template || !PAGE_TEMPLATE_IDS.has(template)) {
    return DEFAULT_PAGE_SETTINGS;
  }

  const requestedMode = (value as Partial<PageSettings>).mode;
  const mode =
    requestedMode && PAGE_CANVAS_MODES.has(requestedMode)
      ? requestedMode
      : template === "off"
      ? "infinite"
      : "a4-vertical";

  return {
    template,
    mode,
    orientation: "portrait",
    pageSize: "a4",
  };
};
