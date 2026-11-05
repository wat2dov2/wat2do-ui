import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const { unstable_doesMiddlewareMatch } = require("next/experimental/testing/server");
const { proxy, config }: typeof import("../src/proxy") = require("../src/proxy");

const cloudflareEdge = "172.70.1.2";
const originalSecret = process.env.ORIGIN_VERIFY_SECRET;
test.beforeEach(() => {
  process.env.ORIGIN_VERIFY_SECRET = "test-origin-secret";
});
test.afterEach(() => {
  if (originalSecret === undefined) delete process.env.ORIGIN_VERIFY_SECRET;
  else process.env.ORIGIN_VERIFY_SECRET = originalSecret;
});

/** The request headers the proxy hands on to the /api rewrite. */
function forwarded(headers: Record<string, string>) {
  const response = proxy(new NextRequest("https://uwo.wat2do.io/api/auth/send-otp", { headers }));
  const header = (name: string) => response.headers.get(`x-middleware-request-${name}`);
  return { viewer: header("x-wat2do-viewer-ip"), verify: header("x-wat2do-origin-verify") };
}

test("a visitor behind Cloudflare is named by CF-Connecting-IP", () => {
  expect(forwarded({ "x-real-ip": cloudflareEdge, "cf-connecting-ip": "203.0.113.7" })).toEqual({
    viewer: "203.0.113.7",
    verify: "test-origin-secret",
  });
  expect(
    forwarded({ "x-real-ip": "2606:4700::1", "cf-connecting-ip": "2001:db8::5" }).viewer,
  ).toBe("2001:db8::5");
});

test("a visitor who skips Cloudflare cannot choose their address", () => {
  expect(
    forwarded({
      "x-real-ip": "198.51.100.4",
      "cf-connecting-ip": "203.0.113.7",
      "x-wat2do-viewer-ip": "203.0.113.8",
    }).viewer,
  ).toBe("198.51.100.4");
});

test("an unreadable address sends none rather than the visitor's own header", () => {
  for (const headers of [
    { "x-wat2do-viewer-ip": "203.0.113.8" },
    { "x-real-ip": cloudflareEdge, "cf-connecting-ip": "not-an-ip", "x-wat2do-viewer-ip": "203.0.113.8" },
  ]) {
    const { viewer, verify } = forwarded(headers);
    expect(viewer).toBeNull();
    expect(verify).toBe("test-origin-secret");
  }
});

test("without the shared secret requests pass through untouched", () => {
  delete process.env.ORIGIN_VERIFY_SECRET;
  expect(forwarded({ "x-real-ip": cloudflareEdge, "cf-connecting-ip": "203.0.113.7" })).toEqual({
    viewer: null,
    verify: null,
  });
});

test("only requests the rewrite sends to the API run the proxy", () => {
  const matches = (path: string) => unstable_doesMiddlewareMatch({ config, url: path });
  for (const path of ["/api/auth/send-otp", "/api/events/", "/api/discovery-queries/", "/api/interactions/batch"])
    expect(matches(path)).toBe(true);
  for (const path of ["/api/discovery", "/api/revalidate-events", "/api/render-instagram-slide", "/events", "/media/a.jpg"])
    expect(matches(path)).toBe(false);
});
