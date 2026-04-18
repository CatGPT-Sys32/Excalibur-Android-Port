import type { Bounds } from "@excalidraw/common";

import {
  doBoundsIntersect,
  getCommonBounds,
  type ExcalidrawElement,
  type NonDeletedExcalidrawElement,
} from "@excalidraw/element";

type Element = NonDeletedExcalidrawElement;
type Elements = readonly NonDeletedExcalidrawElement[];

const normalizeBounds = (bounds: Bounds): Bounds => {
  const [x1, y1, x2, y2] = bounds;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
};

const withErrorMargin = (bounds: Bounds, errorMargin = 0): Bounds => {
  const [x1, y1, x2, y2] = normalizeBounds(bounds);
  return [x1 - errorMargin, y1 - errorMargin, x2 + errorMargin, y2 + errorMargin];
};

const elementBounds = (element: Element): Bounds => {
  return normalizeBounds(getCommonBounds([element]));
};

const asBounds = (bounds: Bounds | ExcalidrawElement): Bounds => {
  if (Array.isArray(bounds)) {
    return normalizeBounds(bounds as Bounds);
  }

  return normalizeBounds(getCommonBounds([bounds as NonDeletedExcalidrawElement]));
};

const boundsInside = (inner: Bounds, outer: Bounds) => {
  const [ix1, iy1, ix2, iy2] = normalizeBounds(inner);
  const [ox1, oy1, ox2, oy2] = normalizeBounds(outer);
  return ix1 >= ox1 && iy1 >= oy1 && ix2 <= ox2 && iy2 <= oy2;
};

export const isElementInsideBBox = (
  element: Element,
  bbox: Bounds,
  eitherDirection = false,
): boolean => {
  const elBounds = elementBounds(element);
  const targetBounds = normalizeBounds(bbox);

  if (boundsInside(elBounds, targetBounds)) {
    return true;
  }

  return eitherDirection ? boundsInside(targetBounds, elBounds) : false;
};

export const elementPartiallyOverlapsWithOrContainsBBox = (
  element: Element,
  bbox: Bounds,
): boolean => {
  const elBounds = elementBounds(element);
  const targetBounds = normalizeBounds(bbox);

  return (
    doBoundsIntersect(elBounds, targetBounds) ||
    boundsInside(elBounds, targetBounds) ||
    boundsInside(targetBounds, elBounds)
  );
};

export const elementsOverlappingBBox = ({
  elements,
  bounds,
  type,
  errorMargin = 0,
}: {
  elements: Elements;
  bounds: Bounds | ExcalidrawElement;
  errorMargin?: number;
  type: "overlap" | "contain" | "inside";
}) => {
  const targetBounds = withErrorMargin(asBounds(bounds), errorMargin);

  return elements.filter((element) => {
    const elBounds = elementBounds(element);

    if (type === "inside") {
      return boundsInside(elBounds, targetBounds);
    }

    if (type === "contain") {
      return (
        boundsInside(elBounds, targetBounds) ||
        boundsInside(targetBounds, elBounds)
      );
    }

    return doBoundsIntersect(elBounds, targetBounds);
  });
};
