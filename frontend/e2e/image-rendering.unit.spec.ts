import { expect, test } from "@playwright/test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import sharp from "sharp";
import imageDelivery from "../../backend/controlbox/image_delivery.json" with { type: "json" };
import instagramPublishing from "../../backend/controlbox/instagram_publishing.json" with { type: "json" };

let renderedSlide: ReactElement<{ model: { imageSrc?: string; avatarSrc?: string; description?: string; siteName?: string; tiles?: string[] } }> | undefined;
let requestSchool = "uwaterloo";
let goingSelections: { event_id: number }[] = [];

// Match the existing server-rendering specs: use React's JSX runtime rather
// than Playwright's browser component-test descriptors. No browser is needed.
const compiledModules = new Map<string, object>();
function loadComponent(path: string): Record<string, React.ComponentType<Record<string, unknown>>> {
  const cached = compiledModules.get(path);
  if (cached) return cached as ReturnType<typeof loadComponent>;
  const filename = new URL(`../src/${path}.tsx`, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const componentModule = { exports: {} as ReturnType<typeof loadComponent> };
  compiledModules.set(path, componentModule.exports);
  const require = createRequire(filename);
  runInNewContext(outputText, {
    exports: componentModule.exports,
    URL,
    Buffer,
    AbortSignal,
    process,
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
    require: (id: string) => {
      if (id === "@/app/client-providers") return { useRequestSchool: () => requestSchool };
      if (id === "@/features/events/hooks/useGoingEvents") return { useGoingEvents: () => ({ data: goingSelections }) };
      if (id === "@/features/clubs/components/ClubBadgeDropdown") return { ClubBadgeDropdown: () => null };
      if (id.endsWith(".png")) return { src: "/logo.png", width: 136, height: 96 };
      if (id.endsWith(".webp")) return { src: `/_next/static/media/${id.split("/").pop()}`, width: 1280, height: 960, blurDataURL: "data:image/webp;base64,UklGRg==" };
      if (id === "react-i18next") return { useTranslation: () => ({ t: (key: string) => key }) };
      if (id === "@/shared/layout") return loadComponent("shared/layout/stack");
      if (id === "@/shared/api/schools.server") return { getSchool: async () => ({ slug: "uwaterloo", name: "University of Waterloo", language: "en", primary_color: "#6b238e", secondary_color: "#ffd54f" }) };
      if (id === "@/features/admin/components/instagram/slides/SlideTemplates") return loadComponent(id.slice(2));
      if (id === "satori") {
        const satori = require(id).default;
        return async (element: typeof renderedSlide, options: object) => {
          renderedSlide = element;
          return satori(element, options);
        };
      }
      if (id.startsWith("@/shared/ui/") && id !== "@/shared/ui/badge-mask-paths") return loadComponent(id.slice(2));
      if (id.startsWith("@/")) return require(new URL(`../src/${id.slice(2)}`, import.meta.url).pathname);
      return require(id);
    },
  });
  return componentModule.exports;
}

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const imageConfig = {
  ...imageConfigDefault,
  formats: [imageDelivery.optimized_format],
  deviceSizes: imageDelivery.device_sizes,
  imageSizes: imageDelivery.image_sizes,
  qualities: [imageDelivery.quality],
  remotePatterns: [{ protocol: "https", hostname: imageDelivery.optimized_remote_host, pathname: `${imageDelivery.optimized_remote_path}**` }],
};
// getImageProps reads the build-injected default rather than React context.
// Mirror next.config for the browser-free component renderer as well.
Object.assign(imageConfigDefault, imageConfig);
const { EventImageCutout } = loadComponent("shared/ui/event-image-cutout");
const { LazyImage } = loadComponent("shared/ui/lazy-image");
const { AvatarStack } = loadComponent("shared/ui/avatar-stack");
const { SchoolPhotoCarousel } = loadComponent("features/contact/components/SchoolPhotoCarousel");
const { EventCardImage } = loadComponent("features/events/components/EventCardImage");
const posterUrl = "https://wat2do.io/media/event-images/poster.jpg";
function render(component: React.ComponentType<Record<string, unknown>>, props: Record<string, unknown>) {
  return renderToStaticMarkup(createElement(ImageConfigContext.Provider, { value: imageConfig }, createElement(component, props)));
}

test("lazy posters have responsive native image URLs before hydration or measurement", () => {
  const html = render(EventImageCutout, {
    backgroundColor: "var(--surface-elevated)", imageSrc: posterUrl, imageAlt: "Campus poster",
    imageLoading: "lazy", cutouts: [], width: 0, height: 0,
  });
  expect(html).toContain('<img alt="Campus poster"');
  expect(html).toContain('loading="lazy"');
  expect(html).toContain('decoding="async"');
  expect(html).toContain('srcSet="/_next/image?url=');
  expect(html).toContain(`&amp;q=${imageDelivery.quality}`);
  expect(html).toContain('sizes="auto, (max-width: 639px) calc(50vw - 16px), 320px"');
  expect(html).not.toContain("<image ");
  expect(html).not.toContain("opacity-0");
});

test("CloudFront shares browser and warmer image variants without changing unsupported clients or page requests", () => {
  const terraform = readFileSync(new URL("../../infra/terraform/production/cloudfront.tf", import.meta.url), "utf8");
  const source = terraform.match(/code = <<-EOT\n([\s\S]*?)\n {2}EOT/)?.[1];
  expect(source).toBeDefined();
  const rendered = source!.replace("${jsonencode(local.image_delivery_control.optimized_format)}", JSON.stringify(imageDelivery.optimized_format));
  type Header = { value: string; multiValue?: { value: string }[] };
  type Request = { uri: string; headers: Record<string, Header> };
  const handler = runInNewContext(`${rendered}\nhandler`) as (event: { viewer: { ip: string }; request: Request }) => Request;
  const invoke = (accept?: string | Header, uri = "/_next/image") => handler({
    viewer: { ip: "192.0.2.1" },
    request: { uri, headers: { host: { value: "uwo.wat2do.io" },
      ...(accept === undefined ? {} : { accept: typeof accept === "string" ? { value: accept } : accept }) } },
  });
  for (const accept of [
    imageDelivery.optimized_format,
    "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "image/webp;q=0.5,image/png;q=1",
    "IMAGE/WEBP; Q=0.8",
    { value: "image/png", multiValue: [{ value: "image/png" }, { value: "image/webp;q=0.9" }] },
  ]) {
    expect(invoke(accept).headers.accept).toEqual({ value: imageDelivery.optimized_format });
  }
  for (const accept of [undefined, "*/*", "image/*", "image/png,image/jpeg", "image/webp;q=0,*/*;q=1", "image/webp;q=0.0", "image/webp;q=invalid", "image/webp;q=2"]) {
    expect(invoke(accept).headers.accept).toEqual({ value: "*/*" });
  }
  const page = invoke("text/html,image/webp", "/events");
  expect(page.headers.accept).toEqual({ value: "text/html,image/webp" });
  expect(page.headers["x-forwarded-host"]).toEqual({ value: "uwo.wat2do.io" });
  expect(page.headers["x-wat2do-viewer-ip"]).toEqual({ value: "192.0.2.1" });
  const imageBehavior = terraform.match(/path_pattern\s+= "\/_next\/image\*"([\s\S]*?)\n {2}}/)?.[1];
  expect(imageBehavior).toContain("function_arn = aws_cloudfront_function.forward_viewer_host.arn");
});

test("measured cutouts mask the HTML image face and eager posters receive priority", () => {
  const html = render(EventImageCutout, {
    backgroundColor: "var(--surface-elevated)", imageSrc: posterUrl, imageAlt: "Campus poster",
    imageLoading: "eager", cutouts: [{ corner: "bottom-left", width: 112, height: 32 }], width: 240, height: 208,
  });
  expect(html).toContain("clip-path:path(&quot;");
  expect(html).toContain('data-slot="event-image-face"');
  expect(html).not.toContain("mask-image:");
  expect(html).toContain('loading="eager"');
  expect(html).toContain('fetchpriority="high"');
  expect(html).toContain('sizes="(max-width: 639px) calc(50vw - 16px), 320px"');
  expect(html).not.toContain('sizes="auto,');
});

test("direct clipping pixels remove each measured corner while preserving the image face", async () => {
  for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    for (const badgeWidth of [72, 160]) {
      const html = render(EventImageCutout, {
        backgroundColor: "white", cutouts: [{ corner, width: badgeWidth, height: 32 }],
        width: 240, height: 208,
      });
      const path = html.match(/clip-path:path\(&quot;([^&]+)&quot;\)/)?.[1];
      expect(path).toBeDefined();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="208"><path d="${path}" fill="white"/></svg>`;
      const { data, info } = await sharp(Buffer.from(svg))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
      const x = corner.endsWith("left") ? badgeWidth - 20 : 240 - badgeWidth + 20;
      const y = corner.startsWith("top") ? 8 : 200;
      expect(alpha(x, y)).toBe(0);
      expect(alpha(120, 104)).toBe(255);
      const outsideX = corner.endsWith("left") ? badgeWidth + 12 : 240 - badgeWidth - 12;
      expect(alpha(outsideX, y)).toBe(255);
    }
  }
});

test("custom carousel photos stay inside the measured transparent face", () => {
  const html = render(EventImageCutout, {
    backgroundColor: "var(--muted)",
    imageContent: createElement("img", { src: "/_next/static/media/campus.webp", alt: "Campus" }),
    cutouts: [{ corner: "bottom-left", width: 240, height: 48 }],
    width: 640, height: 480,
  });
  expect(html.match(/<img /g)).toHaveLength(1);
  expect(html).toMatch(/<div[^>]*data-slot="event-image-face"[^>]*clip-path:[^>]*><img /);
  expect(html).toContain("clip-path:path(&quot;");
  expect(html).not.toContain('data-slot="lazy-image"');
});

test("attendee avatars are discoverable before hydration and request avatar-sized candidates", () => {
  const html = render(AvatarStack, {
    avatars: [{ src: "https://wat2do.io/media/avatars/student.jpg", name: "Taylor Q." }],
    overflowCount: 2,
    overflowLabel: "2 more attendees",
  });
  expect(html).toContain('data-slot="avatar-stack"');
  expect(html).toContain('<img alt="Taylor Q."');
  expect(html).toContain('loading="lazy"');
  expect(html).toContain('width="32" height="32"');
  expect(html).toContain(`&amp;w=32&amp;q=${imageDelivery.quality} 1x`);
  expect(html).toContain(`&amp;w=64&amp;q=${imageDelivery.quality} 2x`);
  expect(html).not.toContain("&amp;w=1080");
  expect(html).toContain('aria-label="2 more attendees"');
});

test("stored poster templates use responsive thumbnails without requesting the full print image", () => {
  const src = "/poster-templates/campus-colour-v1.png";
  const html = render(LazyImage, { src, alt: "Campus Colour", sizes: "80px" });
  expect(html).toContain('sizes="auto, 80px"');
  expect(html).toContain('loading="lazy"');
  expect(html).toContain(`srcSet="/_next/image?url=${encodeURIComponent(src)}`);
  expect(html).not.toContain(`src="${src}"`);
});

test("tiny owned logos get tiny candidates while external and local preview sources remain usable", () => {
  const logo = render(LazyImage, { src: posterUrl, alt: "", width: 12, height: 12 });
  expect(logo).toContain(`&amp;w=${imageDelivery.image_sizes[0]}&amp;q=${imageDelivery.quality}`);
  expect(logo).not.toContain("&amp;w=1080");
  for (const src of ["https://external.example/poster.jpg", "https://legacy.supabase.co/storage/v1/object/public/event-images/poster.jpg", "blob:http://localhost/preview", "data:image/png;base64,AA=="]) {
    const html = render(LazyImage, { src, alt: "Preview", sizes: "320px" });
    expect(html).toContain(`src="${src}"`);
    expect(html).not.toContain("/_next/image");
  }
});

test("missing posters render an accessible fallback without an empty network request", () => {
  const html = render(LazyImage, { src: null, alt: "Campus poster", sizes: "320px" });
  expect(html).toContain('data-image-state="missing"');
  expect(html).toContain('role="img" aria-label="Campus poster"');
  expect(html).not.toContain("<img ");
});

test("video details keep an optimized poster and defer video bytes until playback", () => {
  const videoUrl = "https://wat2do.io/media/event-videos/reel.mp4";
  const html = render(EventImageCutout, {
    backgroundColor: "var(--surface-elevated)", imageSrc: posterUrl, imageAlt: "Campus reel",
    videoSrc: videoUrl, cutouts: [], width: 320, height: 320,
  });
  expect(html).toContain(`<video src="${videoUrl}"`);
  expect(html).toContain('poster="/_next/image?url=');
  expect(html).toContain('preload="none"');
  expect(html).toContain('controls=""');
  expect(html).toContain('playsinline=""');
  expect(html).toContain('data-vaul-no-drag="true"');
  expect(html).not.toContain("autoplay");
  expect(html).not.toContain('<img alt="Campus reel"');
  expect(html).not.toContain('data-slot="event-image-overlay"');
});

test("poster zoom overlays remain interactive only when the caller supplies a control", () => {
  const html = render(EventImageCutout, {
    backgroundColor: "var(--surface-elevated)", imageSrc: posterUrl, imageAlt: "Campus poster",
    cutouts: [], width: 320, height: 320,
    children: createElement("button", { type: "button", "aria-label": "View poster" }),
  });
  expect(html).toContain('data-slot="event-image-overlay"');
  expect(html).toContain('<button type="button" aria-label="View poster"');
});

test.describe("Instagram raster preparation", () => {
  const originalFetch = globalThis.fetch;
  const originalStorageBase = process.env.STORAGE_PUBLIC_BASE_URL;
  const originalLogo = process.env.NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG;
  const originalDoodles = process.env.NEXT_PUBLIC_CLUB_CATEGORY_DOODLE_SVGS;
  const originalMapKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  let POST: typeof import("../src/app/api/render-instagram-slide/route").POST;

  test.beforeAll(() => {
    const assetsRoot = new URL("../public/", import.meta.url);
    process.env.NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG = readFileSync(new URL("instagram-cover-logo.svg", assetsRoot), "utf8");
    const doodles = new URL("icons/club-categories/", assetsRoot);
    process.env.NEXT_PUBLIC_CLUB_CATEGORY_DOODLE_SVGS = JSON.stringify(Object.fromEntries(
      readdirSync(doodles).filter(name => name.endsWith(".svg")).map(name => [`/icons/club-categories/${name}`, readFileSync(new URL(name, doodles), "utf8")]),
    ));
    POST = loadComponent("app/api/render-instagram-slide/route").POST as unknown as typeof POST;
  });
  test.afterAll(() => {
    if (originalLogo === undefined) delete process.env.NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG;
    else process.env.NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG = originalLogo;
    if (originalDoodles === undefined) delete process.env.NEXT_PUBLIC_CLUB_CATEGORY_DOODLE_SVGS;
    else process.env.NEXT_PUBLIC_CLUB_CATEGORY_DOODLE_SVGS = originalDoodles;
  });
  test.beforeEach(() => {
    process.env.STORAGE_PUBLIC_BASE_URL = "https://wat2do.io/media";
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  });
  test.afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalStorageBase === undefined) delete process.env.STORAGE_PUBLIC_BASE_URL;
    else process.env.STORAGE_PUBLIC_BASE_URL = originalStorageBase;
    if (originalMapKey === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    else process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = originalMapKey;
  });

  function request(body: object) {
    const secret = process.env.INSTAGRAM_SLIDE_RENDER_SECRET?.trim();
    return new NextRequest("http://localhost/api/render-instagram-slide", {
      method: "POST", body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    });
  }

  for (const format of ["webp", "png", "jpeg"] as const) {
    test(`resizes ${format} posters without dropping their pixels from the published slide`, async () => {
      const poster = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: { r: 240, g: 80, b: 20 } } }).toFormat(format).toBuffer();
      globalThis.fetch = async () => new Response(poster, { headers: { "content-type": `image/${format}` } });
      const response = await POST(request({
        kind: "event", school: "uwaterloo",
        event: { id: 1, tz: "America/Toronto", category: "Arts & Culture", title: "Poster regression", source_image_url: posterUrl },
      }));
      expect(response.status).toBe(200);
      const prepared = Buffer.from(renderedSlide!.props.model.imageSrc!.split(",")[1], "base64");
      const metadata = await sharp(prepared).metadata();
      expect(metadata.format).toBe("png");
      expect([metadata.width, metadata.height]).toEqual([952, 1000]);
      const output = Buffer.from(await response.arrayBuffer());
      const pixels = await sharp(output).extract({ left: 540, top: 400, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
      for (const [channel, expected] of [240, 80, 20].entries()) expect(Math.abs(pixels[channel] - expected)).toBeLessThanOrEqual(3);
      expect(renderedSlide!.props.model.avatarSrc).toBe("");
      const final = await sharp(output).metadata();
      expect([final.width, final.height]).toEqual([1080, 1350]);
    });
  }

  for (const { kind, width, height } of [
    { kind: "portrait", width: 1600, height: 2000 },
    { kind: "landscape", width: 1800, height: 1200 },
  ]) {
    test(`${kind} event artwork fills every image edge with a centered crop`, async () => {
      const corners = [
        { right: false, bottom: false, color: [220, 20, 30] },
        { right: true, bottom: false, color: [20, 160, 40] },
        { right: false, bottom: true, color: [30, 70, 210] },
        { right: true, bottom: true, color: [170, 30, 190] },
      ];
      // The outer magenta strips should be cropped away, never stretched or
      // letterboxed. Four quadrants expose a crop biased away from the center.
      const quadrants = corners.map(({ right, bottom, color }) => `<rect x="${right ? width / 2 : 0}" y="${bottom ? height / 2 : 0}" width="${width / 2}" height="${height / 2}" fill="rgb(${color.join(",")})"/>`).join("");
      const strips = kind === "portrait"
        ? `<rect width="${width}" height="100" fill="#ff00ff"/><rect y="${height - 100}" width="${width}" height="100" fill="#ff00ff"/>`
        : `<rect width="100" height="${height}" fill="#ff00ff"/><rect x="${width - 100}" width="100" height="${height}" fill="#ff00ff"/>`;
      const poster = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${quadrants}${strips}</svg>`)).png().toBuffer();
      globalThis.fetch = async () => new Response(poster, { headers: { "content-type": "image/png" } });
      const response = await POST(request({
        kind: "event", school: "uwaterloo",
        event: { id: 42, tz: "America/Toronto", category: "Arts & Culture", title: "Edge-to-edge poster", source_image_url: posterUrl },
      }));
      expect(response.status).toBe(200);
      const prepared = Buffer.from(renderedSlide!.props.model.imageSrc!.split(",")[1], "base64");
      const metadata = await sharp(prepared).metadata();
      const output = Buffer.from(await response.arrayBuffer());
      for (const { right, bottom, color } of corners) {
        for (const { left, top } of [
          { left: right ? 950 : 1, top: bottom ? 998 : 1 },
          { left: right ? 486 : 466, top: bottom ? 510 : 490 },
        ]) {
          const publishedPixel = await sharp(output).extract({ left: 64 + left, top: 196 + top, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
          expect([...publishedPixel]).toEqual(color);
        }
      }
      expect([metadata.width, metadata.height]).toEqual([952, 1000]);
    });
  }

  test("club avatars survive the actual published PNG render", async () => {
    const avatarUrl = "https://wat2do.io/media/club-logos/film-club.webp";
    const poster = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: "#ef5014" } }).webp().toBuffer();
    const avatar = await sharp({ create: { width: 320, height: 320, channels: 3, background: "#2e5ac8" } }).webp().toBuffer();
    const fetched: string[] = [];
    globalThis.fetch = async (url, options) => {
      fetched.push(String(url));
      expect(options?.redirect).toBe("error");
      return new Response(String(url) === avatarUrl ? avatar : poster, { headers: { "content-type": "image/webp" } });
    };
    const description = "Join the campus film club for an evening of short films and conversation.";
    const response = await POST(request({
      kind: "event", school: "uwaterloo",
      event: {
        id: 42, tz: "America/Toronto", category: "Arts & Culture", title: "Campus Film Night",
        club: "Campus Film Club", club_ig: "campusfilm", description,
        source_image_url: posterUrl, club_logo_url: avatarUrl, location: "Student Life Centre",
        dtstart_utc: "2026-10-02T23:00:00Z", dtend_utc: "2026-10-03T01:00:00Z",
      },
    }));
    expect(response.status).toBe(200);
    expect(fetched.sort()).toEqual([posterUrl, avatarUrl].sort());
    const model = renderedSlide!.props.model;
    expect(model).not.toHaveProperty("description");
    expect(model.siteName).toContain("uwaterloo.wat2do.io");
    const prepared = Buffer.from(model.avatarSrc!.split(",")[1], "base64");
    const metadata = await sharp(prepared).metadata();
    expect(metadata.format).toBe("png");
    expect([metadata.width, metadata.height]).toEqual([88, 88]);
    const output = Buffer.from(await response.arrayBuffer());
    const artifact = test.info().outputPath("published-event-slide.png");
    writeFileSync(artifact, output);
    await test.info().attach("published-event-slide", { path: artifact, contentType: "image/png" });
    const header = await sharp(output).extract({ left: 0, top: 0, width: 1080, height: 160 }).removeAlpha().raw().toBuffer();
    let avatarPixels = 0;
    for (let index = 0; index < header.length; index += 3) {
      if ([46, 90, 200].every((value, channel) => Math.abs(header[index + channel] - value) <= 3)) avatarPixels++;
    }
    expect(avatarPixels).toBeGreaterThan(1000);
    expect(renderToStaticMarkup(renderedSlide!)).not.toContain(description);
  });

  test("published artwork has a branded inset, blank white footer and stable stickers", async () => {
    const poster = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#ef5014" } }).png().toBuffer();
    const fetched: string[] = [];
    globalThis.fetch = async url => { fetched.push(String(url)); return new Response(poster, { headers: { "content-type": "image/png" } }); };
    const payload = { kind: "event", school: "uwaterloo", event: {
      id: 42, club_id: 7, tz: "America/Toronto", category: "Arts & Culture", title: "Campus Film Night",
      club: "Film Club", source_image_url: posterUrl, description: "REMOVED FOOTER TEXT",
      sticker_ids: ["movie-night", "bring-a-friend", "campus-pick"],
    } };
    const response = await POST(request(payload));
    const output = Buffer.from(await response.arrayBuffer());
    const again = await POST(request(payload));
    expect(Buffer.from(await again.arrayBuffer()).equals(output)).toBe(true);
    expect(fetched).toEqual([posterUrl, posterUrl]);
    const markup = renderToStaticMarkup(renderedSlide!);
    expect(markup).toContain("Movie night");
    expect(markup).not.toContain("REMOVED FOOTER TEXT");
    const pixel = async (left: number, top: number) => [...await sharp(output).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
    expect(await pixel(540, 600)).toEqual([239, 80, 20]);
    expect(await pixel(540, 1100)).toEqual([239, 80, 20]);
    expect(await pixel(980, 1240)).toEqual([255, 255, 255]);
    for (const [left, top] of [[10, 10], [1070, 600], [10, 600], [540, 1340]]) {
      expect(await pixel(left, top)).not.toEqual([255, 255, 255]);
    }
    const artifact = test.info().outputPath("sticker-event-slide.png");
    writeFileSync(artifact, output);
    await test.info().attach("sticker-event-slide", { path: artifact, contentType: "image/png" });
  });

  for (const [kind, visiblePrefix] of Object.entries({
    paragraph: "Join the campus film club for an evening of short films, good conversation, and new friends. ".repeat(8),
    unbroken: "campusfilm".repeat(100),
  })) {
    test(`long ${kind} descriptions do not reappear in the cleared footer`, async () => {
      const poster = await sharp({ create: { width: 1080, height: 840, channels: 3, background: "#ef5014" } }).png().toBuffer();
      globalThis.fetch = async () => new Response(poster, { headers: { "content-type": "image/png" } });
      const renderDescription = async (description: string) => {
        const response = await POST(request({
          kind: "event", school: "uwaterloo",
          event: {
            id: 42, tz: "America/Toronto", category: "Arts & Culture", title: "Campus Film Night",
            club: "Campus Film Club", club_ig: "campusfilm", description, source_image_url: posterUrl,
            location: "Student Life Centre", dtstart_utc: "2026-10-02T23:00:00Z", dtend_utc: "2026-10-03T01:00:00Z",
          },
        }));
        expect(response.status).toBe(200);
        return Buffer.from(await response.arrayBuffer());
      };
      const original = await renderDescription(`${visiblePrefix}A hidden closing sentence.`);
      const changedEnding = await renderDescription(`${visiblePrefix}A different hidden ending that must not move the event details.`);
      expect(changedEnding.equals(original)).toBe(true);
      const artifact = test.info().outputPath("long-caption-event-slide.png");
      writeFileSync(artifact, original);
      await test.info().attach("long-caption-event-slide", { path: artifact, contentType: "image/png" });
    });
  }

  for (const avatarUrl of [
    "https://outside.example/avatar.png",
    "http://127.0.0.1/avatar.png",
    "https://wat2do.io/private/avatar.png",
  ]) {
    test(`avatar preparation falls back without fetching outside storage: ${avatarUrl}`, async () => {
      const fetched: string[] = [];
      globalThis.fetch = async url => {
        fetched.push(String(url));
        throw new Error("Unexpected network request");
      };
      const response = await POST(request({
        kind: "event", school: "uwaterloo",
        event: { id: 42, tz: "America/Toronto", category: "Arts & Culture", club_ig: "campusfilm", club_logo_url: avatarUrl },
      }));
      expect(response.status).toBe(200);
      expect(renderedSlide!.props.model.avatarSrc).toBe("");
      expect(renderToStaticMarkup(renderedSlide!)).toContain("CA</div>");
      expect(fetched).toEqual([]);
    });
  }

  for (const failure of ["404", "non-image"] as const) {
    test(`an optional avatar ${failure} preserves the event poster`, async () => {
      const avatarUrl = "https://wat2do.io/media/club-logos/missing.png";
      const poster = await sharp({ create: { width: 1080, height: 840, channels: 3, background: "#ef5014" } }).png().toBuffer();
      const fetched: string[] = [];
      globalThis.fetch = async url => {
        fetched.push(String(url));
        if (String(url) === avatarUrl) {
          return failure === "404"
            ? new Response(null, { status: 404 })
            : new Response("Not an image", { headers: { "content-type": "text/html" } });
        }
        return new Response(poster, { headers: { "content-type": "image/png" } });
      };
      const response = await POST(request({
        kind: "event", school: "uwaterloo",
        event: { id: 42, tz: "America/Toronto", category: "Arts & Culture", club_ig: "campusfilm", club_logo_url: avatarUrl, source_image_url: posterUrl },
      }));
      expect(response.status).toBe(200);
      expect(fetched.sort()).toEqual([posterUrl, avatarUrl].sort());
      expect(renderedSlide!.props.model.avatarSrc).toBe("");
      expect(renderToStaticMarkup(renderedSlide!)).toContain("CA</div>");
      const output = Buffer.from(await response.arrayBuffer());
      const pixels = await sharp(output).extract({ left: 540, top: 400, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
      expect([...pixels]).toEqual([239, 80, 20]);
    });
  }

  test("a failed event poster still rejects slide rendering", async () => {
    globalThis.fetch = async () => new Response(null, { status: 404 });
    await expect(POST(request({
      kind: "event", school: "uwaterloo",
      event: { id: 42, tz: "America/Toronto", category: "Arts & Culture", source_image_url: posterUrl },
    }))).rejects.toThrow("Slide image download failed: HTTP 404");
  });

  test("cover preparation downloads repeated posters once and omits tiles beyond the carousel limit", async () => {
    const poster = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: "#ef5014" } }).webp().toBuffer();
    const fetched: string[] = [];
    globalThis.fetch = async url => {
      fetched.push(String(url));
      return new Response(poster, { headers: { "content-type": "image/webp" } });
    };
    const events = Array.from({ length: instagramPublishing.maximum_event_slides }, (_, index) => ({ id: index + 1, source_image_url: posterUrl }));
    const response = await POST(request({ kind: "cover", school: "uwaterloo", local_date: "2026-09-26", events: [...events, { id: 99, source_image_url: "https://outside.example/unused.jpg" }] }));
    expect(response.status).toBe(200);
    expect(fetched).toEqual([posterUrl]);
    expect(renderedSlide!.props.model.tiles).toHaveLength(instagramPublishing.maximum_event_slides);
    const prepared = Buffer.from(renderedSlide!.props.model.tiles![0].split(",")[1], "base64");
    const metadata = await sharp(prepared).metadata();
    expect([metadata.width, metadata.height]).toEqual([220, 308]);
  });
});


test("school carousel loads the cached static photo directly with accessible navigation", () => {
  const html = render(SchoolPhotoCarousel, {});
  expect(html.match(/<img /g)).toHaveLength(1);
  expect(html).toContain("utsg-university-college");
  expect(html).toMatch(/src="\/_next\/static\/media\/utsg-university-college[^"]*"/);
  expect(html).not.toContain("/_next/image?");
  expect(html).not.toContain('loading="lazy"');
  expect(html).toContain('aria-label="contact.photos.previous"');
  expect(html).toContain('aria-label="contact.photos.next"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('object-contain');
  expect(html.match(/<h1 /g)).toHaveLength(1);
  expect(html).toMatch(/<h1[^>]*>contact\.hero\.line1 contact\.hero\.line2<\/h1>/);
  // The greeting uses the measured transparent face, not painted corner glyphs.
  expect(html).toContain('data-slot="event-image-face"');
  expect(html).not.toContain('text-background');
  expect(html).not.toMatch(/<div[^>]*class="[^"]*bg-background[^"]*"[^>]*><h1/);
});

test("school carousel prioritizes matching campus photos without a data request", () => {
  for (const [school, photo] of Object.entries({
    utsg: "utsg-university-college", yorku: "york-stadium-selfie", ocadu: "ocad-sharp-centre",
    tmu: "tmu-recreation-centre", utsc: "utsc-welcome-sign", uwaterloo: "utsg-university-college",
  })) {
    requestSchool = school;
    try {
      const html = render(SchoolPhotoCarousel, {});
      expect(html).toContain(`src="/_next/static/media/${photo}.webp"`);
      expect(html.match(/<img /g)).toHaveLength(1);
    } finally {
      requestSchool = "uwaterloo";
    }
  }
});

test("Going uses the top-left badge without obscuring posters or detail videos", () => {
  goingSelections = [{ event_id: 42 }];
  try {
    for (const variant of ["card", "detail"]) {
      const html = render(EventCardImage, { event: {
        id: 42, title: "Campus event", occurrences: [], source_image_url: posterUrl,
        source_video_url: variant === "detail" ? "https://wat2do.io/media/event.mp4" : undefined,
        added_at: new Date().toISOString(),
      }, variant });
      expect(html).toContain("events.going");
      expect(html).toContain("absolute top-0 left-0");
      expect(html).not.toContain("events.new");
      expect(html).not.toContain("bg-image-scrim");
      expect(html).toContain('data-slot="event-image-face"');
    }
  } finally {
    goingSelections = [];
  }
  const fresh = render(EventCardImage, { event: {
    id: 42, title: "Campus event", occurrences: [], source_image_url: posterUrl,
    added_at: new Date().toISOString(),
  }, variant: "card" });
  expect(fresh).toContain("events.new");
  expect(fresh).not.toContain("events.going");
});

test("school photos are compact, correctly oriented WebP assets without embedded metadata", async () => {
  const directory = new URL("../src/assets/", import.meta.url);
  const files = readdirSync(directory).filter((file) => /^(ocad|tmu|utsc|utsg|york)-.*\.webp$/.test(file));
  expect(files).toHaveLength(20);
  for (const file of files) {
    const bytes = readFileSync(new URL(file, directory));
    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(1280);
    expect(bytes.length).toBeLessThan(350 * 1024);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  }
});


test("About loading preserves the carousel frame, greeting, caption and controls", () => {
  const html = render(SchoolPhotoCarousel, { isLoading: true });
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('aspect-[4/3]');
  expect(html).toContain('data-slot="skeleton"');
  expect(html).not.toContain('<img ');
  expect(html.match(/<h1 /g)).toHaveLength(1);
  expect(html).toContain('University of Toronto St. George');
  expect(html.match(/disabled=""/g)).toHaveLength(2);
});


for (const variant of ["card", "detail"]) {
  test(`directory ${variant} uses the club profile picture with existing cropping`, () => {
    const logo = "https://wat2do.io/media/organization-logos/laurier.jpg";
    const html = render(EventCardImage, { variant, event: {
      id: 42, title: "Laurier event", occurrences: [], added_at: "2026-09-01T00:00:00Z",
      is_directory_event: true, source_image_url: posterUrl, club_logo_url: logo,
    }});
    expect(html).toContain(encodeURIComponent(logo));
    expect(html).not.toContain(encodeURIComponent(posterUrl));
    expect(html).toContain("object-cover");
  });

  test(`directory ${variant} without a profile picture uses the title fallback`, () => {
    const html = render(EventCardImage, { variant, event: {
      id: 42, title: "Laurier event", occurrences: [], added_at: "2026-09-01T00:00:00Z",
      is_directory_event: true, source_image_url: posterUrl, club_logo_url: null,
    }});
    expect(html).toContain('data-slot="event-poster-fallback"');
    expect(html).toContain("Laurier event");
    expect(html).not.toContain(encodeURIComponent(posterUrl));
    expect(html).not.toContain('cursor-zoom-in');
  });
}

test("ordinary events retain their event poster even with a club profile picture", () => {
  const logo = "https://wat2do.io/media/organization-logos/club.jpg";
  const html = render(EventCardImage, { variant: "card", event: {
    id: 42, title: "Real event poster", occurrences: [], added_at: "2026-09-01T00:00:00Z",
    is_directory_event: false, source_image_url: posterUrl, club_logo_url: logo,
  }});
  expect(html).toContain(encodeURIComponent(posterUrl));
  expect(html).not.toContain(encodeURIComponent(logo));
});
