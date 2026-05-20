import type { CSSProperties } from "react";

type WaterpaintStyle = CSSProperties & Record<`--waterpaint-${string}`, string>;

function seedFromString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash || 1;
}

function seededPercent(seed: number, salt: number, min: number, max: number): string {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  const fraction = x - Math.floor(x);
  return `${Math.round(min + fraction * (max - min))}%`;
}

export function getEventCardWaterpaintStyle(seedValue: number | string): WaterpaintStyle {
  const seed = typeof seedValue === "number" ? seedValue : seedFromString(seedValue);

  return {
    "--waterpaint-color-1-x": seededPercent(seed, 1, 6, 24),
    "--waterpaint-color-1-y": seededPercent(seed, 2, 8, 30),
    "--waterpaint-color-2-x": seededPercent(seed, 3, 70, 94),
    "--waterpaint-color-2-y": seededPercent(seed, 4, 4, 24),
    "--waterpaint-color-3-x": seededPercent(seed, 5, 36, 70),
    "--waterpaint-color-3-y": seededPercent(seed, 6, 48, 78),
    "--waterpaint-color-4-x": seededPercent(seed, 7, 4, 22),
    "--waterpaint-color-4-y": seededPercent(seed, 8, 76, 104),
    "--waterpaint-light-1-x": seededPercent(seed, 9, 12, 38),
    "--waterpaint-light-1-y": seededPercent(seed, 10, 8, 34),
    "--waterpaint-light-2-x": seededPercent(seed, 11, 58, 88),
    "--waterpaint-light-2-y": seededPercent(seed, 12, 12, 38),
    "--waterpaint-light-3-x": seededPercent(seed, 13, 28, 58),
    "--waterpaint-light-3-y": seededPercent(seed, 14, 54, 84),
    "--waterpaint-light-4-x": seededPercent(seed, 15, 70, 98),
    "--waterpaint-light-4-y": seededPercent(seed, 16, 72, 104),
    "--waterpaint-color-rotate": `${Number.parseInt(seededPercent(seed, 17, -8, 4), 10)}deg`,
    "--waterpaint-light-rotate": `${Number.parseInt(seededPercent(seed, 18, -2, 10), 10)}deg`,
  };
}
