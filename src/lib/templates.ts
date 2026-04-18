import {
  newArrowElement,
  newElement,
  newLinearElement,
  newTextElement,
  syncInvalidIndices,
} from "@excalidraw/element";

import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { LocalPoint } from "@excalidraw/math";

export type CanvasTemplate = {
  id: string;
  name: string;
  description: string;
  initialData: ExcalidrawInitialDataState;
};

const text = (label: string, x: number, y: number, fontSize = 22) =>
  newTextElement({
    text: label,
    x,
    y,
    fontSize,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
  });

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  backgroundColor = "transparent",
) =>
  newElement({
    type: "rectangle",
    x,
    y,
    width,
    height,
    strokeColor: "#1e1e1e",
    backgroundColor,
    roughness: 1,
    roundness: { type: 3 },
  });

const diamond = (x: number, y: number, width: number, height: number) =>
  newElement({
    type: "diamond",
    x,
    y,
    width,
    height,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    roughness: 1,
  });

const point = (x: number, y: number) => [x, y] as unknown as LocalPoint;

const arrow = (x: number, y: number, width: number, height: number) =>
  newArrowElement({
    type: "arrow",
    x,
    y,
    width,
    height,
    points: [
      point(0, 0),
      point(width, height),
    ],
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    endArrowhead: "arrow",
  });

const line = (x: number, y: number, width: number, height: number) =>
  newLinearElement({
    type: "line",
    x,
    y,
    width,
    height,
    points: [
      point(0, 0),
      point(width, height),
    ],
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
  });

const makeTemplate = (
  id: string,
  name: string,
  description: string,
  elements: ReturnType<
    typeof text | typeof rect | typeof diamond | typeof arrow | typeof line
  >[],
): CanvasTemplate => ({
  id,
  name,
  description,
  initialData: {
    elements: syncInvalidIndices(elements) as OrderedExcalidrawElement[],
    appState: {
      name,
      viewBackgroundColor: "#ffffff",
    },
    files: {},
  },
});

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  makeTemplate("meeting-notes", "Meeting Notes", "Agenda, notes, decisions, and next actions.", [
    text("Meeting Notes", -260, -220, 30),
    rect(-280, -150, 250, 280),
    rect(10, -150, 250, 280),
    text("Agenda", -250, -125, 22),
    text("Notes", 40, -125, 22),
    line(-250, -78, -70, 0),
    line(-250, -30, -70, 0),
    line(40, -78, 150, 0),
    line(40, -30, 150, 0),
    rect(-280, 170, 540, 125),
    text("Decisions / Actions", -250, 195, 22),
    line(-250, 245, 445, 0),
  ]),
  makeTemplate("architecture", "Architecture", "Client, API, services, and storage blocks.", [
    text("Architecture", -280, -230, 30),
    rect(-300, -130, 170, 90),
    text("Client", -255, -100, 20),
    rect(-35, -130, 170, 90),
    text("API", 25, -100, 20),
    rect(230, -130, 170, 90),
    text("Service", 270, -100, 20),
    rect(-35, 70, 170, 90),
    text("Storage", 12, 100, 20),
    arrow(-125, -85, 85, 0),
    arrow(140, -85, 85, 0),
    arrow(50, -35, 0, 100),
  ]),
  makeTemplate("flowchart", "Flowchart", "Start, decision, and outcome nodes.", [
    text("Flowchart", -230, -230, 30),
    rect(-80, -165, 160, 65),
    text("Start", -30, -145, 20),
    arrow(0, -95, 0, 80),
    diamond(-90, 10, 180, 120),
    text("Decision", -48, 55, 20),
    arrow(-90, 70, -120, 0),
    arrow(90, 70, 120, 0),
    rect(-330, 35, 150, 70),
    text("Path A", -290, 57, 20),
    rect(180, 35, 150, 70),
    text("Path B", 220, 57, 20),
  ]),
  makeTemplate("mind-map", "Mind Map", "Central topic with four branches.", [
    text("Mind Map", -225, -230, 30),
    rect(-90, -55, 180, 90),
    text("Topic", -30, -25, 22),
    arrow(-95, -20, -140, -90),
    arrow(95, -20, 140, -90),
    arrow(-95, 25, -140, 90),
    arrow(95, 25, 140, 90),
    rect(-360, -155, 140, 60),
    text("Branch", -330, -137, 18),
    rect(220, -155, 140, 60),
    text("Branch", 250, -137, 18),
    rect(-360, 100, 140, 60),
    text("Branch", -330, 118, 18),
    rect(220, 100, 140, 60),
    text("Branch", 250, 118, 18),
  ]),
  makeTemplate("wireframe", "Wireframe", "Header, sidebar, content, and cards.", [
    text("Wireframe", -260, -230, 30),
    rect(-300, -170, 600, 55),
    text("Header", -280, -153, 18),
    rect(-300, -90, 140, 300),
    text("Nav", -260, -65, 18),
    line(-270, -20, 80, 0),
    line(-270, 25, 80, 0),
    line(-270, 70, 80, 0),
    rect(-130, -90, 430, 300),
    text("Content", -100, -65, 18),
    rect(-100, -20, 170, 90),
    rect(100, -20, 170, 90),
    rect(-100, 95, 370, 75),
  ]),
];
