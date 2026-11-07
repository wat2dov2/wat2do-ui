/**
 * Draws a grid of real event posters, each a few pixels square, onto one
 * canvas and keeps it alive: waves of tiles sweep across, each swapping to
 * another poster by resolving from a single colour to its full few pixels,
 * like the animated ASCII backdrops of AI landing pages, with posters for glyphs.
 *
 * All posters come from one atlas (`npm run build-event-mosaic`), so the page
 * loads a single small image however many tiles it shows.
 */

export interface MosaicAtlas {
  image: HTMLImageElement;
  /** Pixels per poster side in the atlas. */
  tilePixels: number;
  /** Posters per atlas row. */
  columns: number;
  count: number;
}

export interface MosaicLook {
  /** CSS pixels per tile side. */
  tileSize: number;
  /** CSS pixels of face left between tiles, so the grid reads as cells. */
  gutter: number;
  /** Tiles per second a wave front travels. */
  waveSpeed: number;
  /** Share of tiles that swap on their own each second, between waves. */
  twinkle: number;
}

/** How long one swap takes to resolve, and how many steps it shows on the way. */
const RESOLVE_MS = 420;
const RESOLVE_STEPS = [1, 3, 6] as const;
/** Swaps run at most this often, which keeps the motion calm and the work small. */
const FRAME_MS = 1000 / 30;

/** The atlas drawn at each coarser resolution a swap passes through, so a step is one drawImage. */
function buildLevels({ image, tilePixels, columns, count }: MosaicAtlas): HTMLCanvasElement[] {
  const rows = Math.ceil(count / columns);
  return RESOLVE_STEPS.map((step) => {
    const level = document.createElement("canvas");
    level.width = columns * step;
    level.height = rows * step;
    const context = level.getContext("2d")!;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, columns * tilePixels, rows * tilePixels, 0, 0, level.width, level.height);
    return level;
  });
}

/**
 * Starts the mosaic on `canvas`, sized to its parent. Returns a stop function.
 * With `animate` false it draws one still mosaic and never swaps a tile.
 */
export function startEventPixelMosaic(
  canvas: HTMLCanvasElement,
  atlas: MosaicAtlas,
  look: MosaicLook,
  animate: boolean,
): () => void {
  const context = canvas.getContext("2d");
  const parent = canvas.parentElement;
  if (!context || !parent) return () => {};

  // A still mosaic never resolves a swap, so it skips the coarser copies.
  const levels = animate ? buildLevels(atlas) : [];
  let columns = 0;
  let rows = 0;
  let scale = 1;
  let posters = new Uint16Array(0);
  /** Each tile's place on the wave's diagonal, with jitter so the front frays like a real wave. */
  let wavePlace = new Float32Array(0);
  let waveSpan = 1;
  /** Tiles mid-swap, by index, to the time their swap started. */
  const resolving = new Map<number, number>();
  let frame = 0;
  let lastTick = 0;
  let wave = 0;
  let visible = true;

  const randomPoster = () => Math.floor(Math.random() * atlas.count);

  function drawTile(index: number, level: CanvasImageSource | null, step: number) {
    const poster = posters[index];
    const sx = (poster % atlas.columns) * step;
    const sy = Math.floor(poster / atlas.columns) * step;
    const x = (index % columns) * look.tileSize * scale;
    const y = Math.floor(index / columns) * look.tileSize * scale;
    const size = (look.tileSize - look.gutter) * scale;
    context!.clearRect(x, y, look.tileSize * scale, look.tileSize * scale);
    context!.drawImage(level ?? atlas.image, sx, sy, step, step, x, y, size, size);
  }

  function drawAll() {
    context!.clearRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < posters.length; index += 1) drawTile(index, null, atlas.tilePixels);
  }

  function resize() {
    const { width, height } = parent!.getBoundingClientRect();
    scale = Math.min(window.devicePixelRatio || 1, 2);
    columns = Math.ceil(width / look.tileSize);
    rows = Math.ceil(height / look.tileSize);
    canvas.width = Math.round(columns * look.tileSize * scale);
    canvas.height = Math.round(rows * look.tileSize * scale);
    canvas.style.width = `${columns * look.tileSize}px`;
    canvas.style.height = `${rows * look.tileSize}px`;
    context!.imageSmoothingEnabled = false;
    posters = Uint16Array.from({ length: columns * rows }, randomPoster);
    wavePlace = Float32Array.from({ length: columns * rows }, (_, index) =>
      (index % columns) * 0.8 + Math.floor(index / columns) * 0.5 + Math.random() * 4);
    // A rest after each wave before the next one enters.
    waveSpan = columns * 0.8 + rows * 0.5 + 4 + columns * 0.6;
    resolving.clear();
    drawAll();
  }

  function swap(index: number, now: number) {
    if (resolving.has(index)) return;
    posters[index] = randomPoster();
    resolving.set(index, now);
  }

  function tick(now: number) {
    frame = requestAnimationFrame(tick);
    if (now - lastTick < FRAME_MS) return;
    const elapsed = lastTick ? Math.min(now - lastTick, 100) : FRAME_MS;
    lastTick = now;

    const previous = wave;
    wave = (wave + (elapsed / 1000) * look.waveSpeed) % waveSpan;
    const wrapped = wave < previous;
    for (let index = 0; index < posters.length; index += 1) {
      const place = wavePlace[index];
      if (wrapped ? place > previous || place <= wave : place > previous && place <= wave) swap(index, now);
    }
    const twinkles = posters.length * look.twinkle * (elapsed / 1000);
    for (let count = Math.floor(twinkles + Math.random()); count > 0; count -= 1) {
      swap(Math.floor(Math.random() * posters.length), now);
    }

    for (const [index, start] of resolving) {
      const progress = (now - start) / RESOLVE_MS;
      if (progress >= 1) {
        drawTile(index, null, atlas.tilePixels);
        resolving.delete(index);
      } else {
        const level = Math.min(RESOLVE_STEPS.length - 1, Math.floor(progress * RESOLVE_STEPS.length));
        drawTile(index, levels[level], RESOLVE_STEPS[level]);
      }
    }
  }

  function run() {
    cancelAnimationFrame(frame);
    lastTick = 0;
    if (animate && visible && document.visibilityState === "visible") frame = requestAnimationFrame(tick);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(parent);
  resize();

  // Off screen or in a background tab, nothing is drawn at all.
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    run();
  });
  intersectionObserver.observe(canvas);
  document.addEventListener("visibilitychange", run);
  run();

  return () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    document.removeEventListener("visibilitychange", run);
  };
}
