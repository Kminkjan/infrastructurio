import type { MapBounds, Point } from "../shared";

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface MapCamera {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

const FIT_PADDING = 32;
const MAX_ZOOM_MULTIPLIER = 8;

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function zoomRange(
  bounds: MapBounds,
  viewport: ViewportSize,
): { readonly minimum: number; readonly maximum: number } {
  const viewportWidth = positive(viewport.width, 1);
  const viewportHeight = positive(viewport.height, 1);
  const mapWidth = positive(bounds.width, 1);
  const mapHeight = positive(bounds.height, 1);
  const horizontalSpace = Math.max(1, viewportWidth - FIT_PADDING * 2);
  const verticalSpace = Math.max(1, viewportHeight - FIT_PADDING * 2);
  const minimum = Math.min(
    horizontalSpace / mapWidth,
    verticalSpace / mapHeight,
  );

  return { minimum, maximum: minimum * MAX_ZOOM_MULTIPLIER };
}

function clampAxis(
  position: number,
  scaledMapSize: number,
  viewportSize: number,
): number {
  if (scaledMapSize <= viewportSize) {
    return (viewportSize - scaledMapSize) / 2;
  }

  return Math.min(0, Math.max(viewportSize - scaledMapSize, position));
}

export function constrainCamera(
  camera: MapCamera,
  bounds: MapBounds,
  viewport: ViewportSize,
): MapCamera {
  const range = zoomRange(bounds, viewport);
  const scale = Math.min(
    range.maximum,
    Math.max(range.minimum, camera.scale),
  );

  return {
    x: clampAxis(camera.x, bounds.width * scale, viewport.width),
    y: clampAxis(camera.y, bounds.height * scale, viewport.height),
    scale,
  };
}

export function fitCamera(
  bounds: MapBounds,
  viewport: ViewportSize,
): MapCamera {
  const scale = zoomRange(bounds, viewport).minimum;

  return constrainCamera({ x: 0, y: 0, scale }, bounds, viewport);
}

export function panCamera(
  camera: MapCamera,
  delta: Point,
  bounds: MapBounds,
  viewport: ViewportSize,
): MapCamera {
  return constrainCamera(
    { ...camera, x: camera.x + delta.x, y: camera.y + delta.y },
    bounds,
    viewport,
  );
}

export function zoomCamera(
  camera: MapCamera,
  factor: number,
  anchor: Point,
  bounds: MapBounds,
  viewport: ViewportSize,
): MapCamera {
  if (!Number.isFinite(factor) || factor <= 0) {
    return camera;
  }

  const range = zoomRange(bounds, viewport);
  const scale = Math.min(
    range.maximum,
    Math.max(range.minimum, camera.scale * factor),
  );
  const worldAnchor = {
    x: (anchor.x - camera.x) / camera.scale,
    y: (anchor.y - camera.y) / camera.scale,
  };

  return constrainCamera(
    {
      x: anchor.x - worldAnchor.x * scale,
      y: anchor.y - worldAnchor.y * scale,
      scale,
    },
    bounds,
    viewport,
  );
}

export function resizeCamera(
  camera: MapCamera,
  bounds: MapBounds,
  previousViewport: ViewportSize,
  viewport: ViewportSize,
): MapCamera {
  const worldCenter = {
    x: (previousViewport.width / 2 - camera.x) / camera.scale,
    y: (previousViewport.height / 2 - camera.y) / camera.scale,
  };

  return constrainCamera(
    {
      x: viewport.width / 2 - worldCenter.x * camera.scale,
      y: viewport.height / 2 - worldCenter.y * camera.scale,
      scale: camera.scale,
    },
    bounds,
    viewport,
  );
}
