import { expect, test } from "@playwright/test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import sharp from "sharp";
import imageDelivery from "../../backend/controlbox/image_delivery.json" with { type: "json" };
import instagramPublishing from "../../backend/controlbox/instagram_publishing.json" with { type: "json" };

let renderedSlide: ReactElement<{ model: { imageSrc?: string; tiles?: string[] } }> | undefined;

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
    process,
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
    require: (id: string) => {
      if (id === "@/shared/api/schools.server") return { getSchool: async () => ({ slug: "uwaterloo", language: "en", primary_color: "#6b238e", secondary_color: "#ffd54f" }) };
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
const { EventImageCutout } = loadComponent("shared/ui/event-image-cutout");
const { LazyImage } = loadComponent("shared/ui/lazy-image");
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
  expect(html).toContain('sizes="(max-width: 479px)');
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
  expect(html).toContain('viewBox="0 0 240 208"');
  expect(html).toContain('maskUnits="userSpaceOnUse"');
  expect(html).toContain('data-slot="event-image-face"');
  expect(html).toContain("mask-image:url(&quot;#");
  expect(html).toContain('loading="eager"');
  expect(html).toContain('fetchpriority="high"');
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

test.describe("Instagram raster preparation", () => {
  const originalFetch = globalThis.fetch;
  const originalStorageBase = process.env.STORAGE_PUBLIC_BASE_URL;
  const originalLogo = process.env.NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG;
  const originalDoodles = process.env.NEXT_PUBLIC_CLUB_CATEGORY_DOODLE_SVGS;
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
  });
  test.afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalStorageBase === undefined) delete process.env.STORAGE_PUBLIC_BASE_URL;
    else process.env.STORAGE_PUBLIC_BASE_URL = originalStorageBase;
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
      expect([metadata.width, metadata.height]).toEqual([672, 840]);
      const output = Buffer.from(await response.arrayBuffer());
      const pixels = await sharp(output).extract({ left: 540, top: 400, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
      for (const [channel, expected] of [240, 80, 20].entries()) expect(Math.abs(pixels[channel] - expected)).toBeLessThanOrEqual(3);
      const final = await sharp(output).metadata();
      expect([final.width, final.height]).toEqual([1080, 1350]);
    });
  }

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
