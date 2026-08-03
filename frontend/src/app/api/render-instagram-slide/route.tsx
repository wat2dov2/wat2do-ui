import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import satori from "satori";
import {
  CoverSlideTemplate,
  EventSlideTemplate,
} from "@/features/admin/components/instagram/slides/SlideTemplates";
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  buildCoverSlideModel,
  buildEventSlideModel,
  type SlideEvent,
} from "@/features/admin/lib/instagramSlides";
import { getSchool } from "@/shared/api/schools.server";
import { getSchoolColors } from "@/shared/lib/schoolBranding";

export const runtime = "nodejs";

interface EventSlideRequest {
  kind: "event";
  event: SlideEvent;
  school?: string | null;
}

interface CoverSlideRequest {
  kind: "cover";
  events: SlideEvent[];
  school?: string | null;
  /** The batch's `local_date`, as `YYYY-MM-DD`. */
  local_date?: string | null;
  /** Events added to the school in the batch's scrape window. */
  new_event_count?: number | null;
  body?: string | null;
}

type SlideRequest = EventSlideRequest | CoverSlideRequest;

const MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024;
// The slide templates mirror the event card's type scale, which uses regular,
// medium, semibold, and bold. satori substitutes the nearest weight it has, so
// every weight the templates ask for is loaded here.
const FONT_FILES = [
  { file: "inter-latin-400-normal.woff", weight: 400 as const },
  { file: "inter-latin-500-normal.woff", weight: 500 as const },
  { file: "inter-latin-600-normal.woff", weight: 600 as const },
  { file: "inter-latin-700-normal.woff", weight: 700 as const },
];

type SlideFontWeight = (typeof FONT_FILES)[number]["weight"];

let fontsPromise: Promise<
  { name: string; data: Buffer; weight: SlideFontWeight; style: "normal" }[]
> | null = null;
let wasmPromise: Promise<void> | null = null;

function loadFonts() {
  fontsPromise ??= Promise.all(
    FONT_FILES.map(async ({ file, weight }) => ({
      name: "Inter",
      data: await readFile(
        path.join(process.cwd(), "node_modules", "@fontsource", "inter", "files", file),
      ),
      weight,
      style: "normal" as const,
    })),
  );
  return fontsPromise;
}

function loadRenderer() {
  wasmPromise ??= readFile(
    path.join(process.cwd(), "node_modules", "@resvg", "resvg-wasm", "index_bg.wasm"),
  ).then((wasm) => initWasm(wasm));
  return wasmPromise;
}

function getBearerSecret(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
}

/**
 * Inline a poster as a data URI.
 *
 * Slide images are only ever our own CloudFront storage objects; anything else is
 * dropped rather than fetched, so this route can never be pointed at an
 * internal host.
 */
async function inlineImage(sourceUrl: string | null | undefined): Promise<string> {
  const storageBase = (() => {
    try {
      return new URL(process.env.STORAGE_PUBLIC_BASE_URL ?? "");
    } catch {
      return null;
    }
  })();
  if (!sourceUrl || !storageBase) return "";

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return "";
  }
  const storagePathPrefix = `${storageBase.pathname.replace(/\/$/, "")}/`;
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== storageBase.origin ||
    !parsed.pathname.startsWith(storagePathPrefix)
  ) {
    return "";
  }

  const response = await fetch(parsed, { redirect: "error" });
  if (!response.ok) return "";
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) return "";

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) return "";
  return `data:${contentType.split(";")[0]};base64,${bytes.toString("base64")}`;
}

async function buildSlide(slide: SlideRequest): Promise<React.ReactElement> {
  if (slide.kind === "event") {
    const imageSrc = await inlineImage(slide.event.source_image_url);
    return <EventSlideTemplate model={buildEventSlideModel(slide.event, imageSrc)} />;
  }

  const tiles = (await Promise.all(slide.events.map((event) => inlineImage(event.source_image_url))))
    .filter((tile) => tile.length > 0);
  const school = slide.school ?? slide.events[0]?.school ?? "";
  const schoolRecord = await getSchool(school);
  if (!schoolRecord) {
    throw new Error(`School not found for slide rendering: ${school}`);
  }
  return (
    <CoverSlideTemplate
      model={buildCoverSlideModel({
        school,
        colors: getSchoolColors(schoolRecord),
        localDate: slide.local_date ?? "",
        // A cover always has at least one event, so the carousel size is the
        // honest floor when the caller cannot say what the scrape found.
        newEventCount: slide.new_event_count ?? slide.events.length,
        eventCount: slide.events.length,
        body: slide.body ?? "",
        tiles,
      })}
    />
  );
}

function isSlideRequest(value: unknown): value is SlideRequest {
  if (typeof value !== "object" || value === null) return false;
  const slide = value as Partial<SlideRequest>;
  if (slide.kind === "event") return typeof (slide as EventSlideRequest).event?.id === "number";
  if (slide.kind === "cover") return Array.isArray((slide as CoverSlideRequest).events);
  return false;
}

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.INSTAGRAM_SLIDE_RENDER_SECRET?.trim();
  if (!configuredSecret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Slide render secret is not configured" }, { status: 500 });
  }
  if (configuredSecret && getBearerSecret(request) !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isSlideRequest(body)) {
    return NextResponse.json({ error: "Unsupported slide payload" }, { status: 400 });
  }
  if (body.kind === "cover" && body.events.length === 0) {
    return NextResponse.json({ error: "A cover needs at least one event" }, { status: 400 });
  }

  const [fonts] = await Promise.all([loadFonts(), loadRenderer()]);
  const svg = await satori(await buildSlide(body), {
    width: SLIDE_WIDTH,
    height: SLIDE_HEIGHT,
    fonts,
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: SLIDE_WIDTH } })
    .render()
    .asPng();

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
    },
  });
}
