export type BadgeMaskVariant = "top-left" | "top-right" | "bottom-left" | "bottom-right";

interface BadgeMaskPaths {
  fillPath: string;
  curvePath: string;
}

export const BADGE_MASK_PATHS: Record<BadgeMaskVariant, BadgeMaskPaths> = {
  "top-left": {
    fillPath: "M64 0C28.65 0 0 28.65 0 64L0 0L64 0Z",
    curvePath: "M64 0C28.65 0 0 28.65 0 64",
  },
  "top-right": {
    fillPath: "M64 64C64 28.65 35.35 0 0 0H64V64Z",
    curvePath: "M0 0C35.35 0 64 28.65 64 64",
  },
  "bottom-left": {
    fillPath: "M0 0C0 35.35 28.65 64 64 64H0V0Z",
    curvePath: "M0 0C0 35.35 28.65 64 64 64",
  },
  "bottom-right": {
    fillPath: "M64 0C64 35.35 35.35 64 0 64H64V0Z",
    curvePath: "M64 0C64 35.35 35.35 64 0 64",
  },
};
