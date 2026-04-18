import { KEYS } from "@excalidraw/common";

import {
  SelectionIcon,
  RectangleIcon,
  DiamondIcon,
  EllipseIcon,
  TriangleIcon,
  ArrowIcon,
  LineIcon,
  FreedrawIcon,
  HighlighterIcon,
  TextIcon,
  ImageIcon,
  EraserIcon,
  laserPointerToolIcon,
  handIcon,
} from "./icons";

import type { AppClassProperties } from "../types";

const TOP_ROW_KEY_CODES: Record<string, string> = {
  [KEYS["1"]]: "Digit1",
  [KEYS["2"]]: "Digit2",
  [KEYS["3"]]: "Digit3",
  [KEYS["4"]]: "Digit4",
  [KEYS["5"]]: "Digit5",
  [KEYS["6"]]: "Digit6",
  [KEYS["7"]]: "Digit7",
  [KEYS["8"]]: "Digit8",
  [KEYS["9"]]: "Digit9",
  [KEYS["0"]]: "Digit0",
  [KEYS.SUBTRACT]: "Minus",
  "=": "Equal",
};

const matchesTopRowShortcut = (
  shortcut: string,
  key: string,
  code?: string,
) => {
  return key === shortcut || (code != null && TOP_ROW_KEY_CODES[shortcut] === code);
};

export const SHAPES = [
  {
    icon: handIcon,
    value: "hand",
    key: KEYS.H,
    numericKey: null,
    fillable: false,
    toolbar: true,
  },
  {
    icon: SelectionIcon,
    value: "selection",
    key: KEYS.V,
    numericKey: KEYS["1"],
    fillable: true,
    toolbar: true,
  },
  {
    icon: RectangleIcon,
    value: "rectangle",
    key: KEYS.R,
    numericKey: KEYS["2"],
    fillable: true,
    toolbar: true,
  },
  {
    icon: DiamondIcon,
    value: "diamond",
    key: KEYS.D,
    numericKey: KEYS["3"],
    fillable: true,
    toolbar: true,
  },
  {
    icon: EllipseIcon,
    value: "ellipse",
    key: KEYS.O,
    numericKey: KEYS["4"],
    fillable: true,
    toolbar: true,
  },
  {
    icon: TriangleIcon,
    value: "triangle",
    key: null,
    numericKey: KEYS["5"],
    fillable: true,
    toolbar: true,
  },
  {
    icon: ArrowIcon,
    value: "arrow",
    key: KEYS.A,
    numericKey: KEYS["6"],
    fillable: true,
    toolbar: true,
  },
  {
    icon: LineIcon,
    value: "line",
    key: KEYS.L,
    numericKey: KEYS["7"],
    fillable: true,
    toolbar: true,
  },
  {
    icon: FreedrawIcon,
    value: "freedraw",
    key: [KEYS.P, KEYS.X],
    numericKey: KEYS["8"],
    fillable: false,
    toolbar: true,
  },
  {
    icon: HighlighterIcon,
    value: "highlighter",
    key: null,
    numericKey: KEYS["9"],
    fillable: false,
    toolbar: true,
  },
  {
    icon: TextIcon,
    value: "text",
    key: KEYS.T,
    numericKey: KEYS["0"],
    fillable: false,
    toolbar: true,
  },
  {
    icon: ImageIcon,
    value: "image",
    key: null,
    numericKey: KEYS.SUBTRACT,
    fillable: false,
    toolbar: true,
  },
  {
    icon: EraserIcon,
    value: "eraser",
    key: KEYS.E,
    numericKey: "=",
    fillable: false,
    toolbar: true,
  },
  {
    icon: laserPointerToolIcon,
    value: "laser",
    key: KEYS.K,
    numericKey: null,
    fillable: false,
    toolbar: false,
  },
] as const;

export const getToolbarTools = (app: AppClassProperties) => {
  return app.state.preferredSelectionTool.type === "lasso"
    ? ([
        {
          value: "lasso",
          icon: SelectionIcon,
          key: KEYS.V,
          numericKey: KEYS["1"],
          fillable: true,
          toolbar: true,
        },
        ...SHAPES.slice(1),
      ] as const)
    : SHAPES;
};

export const findShapeByKey = (
  key: string,
  app: AppClassProperties,
  code?: string,
) => {
  const shape = getToolbarTools(app).find((shape) => {
    return (
      (shape.numericKey != null &&
        matchesTopRowShortcut(shape.numericKey.toString(), key, code)) ||
      (shape.key &&
        (typeof shape.key === "string"
          ? shape.key === key
          : (shape.key as readonly string[]).includes(key)))
    );
  });
  return shape?.value || null;
};
