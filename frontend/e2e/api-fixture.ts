import type { Page, Route } from "@playwright/test";
import type { NextFixture } from "next/experimental/testmode/playwright.js";

type MockResponse = Pick<NonNullable<Parameters<Route["fulfill"]>[0]>, "status" | "headers" | "contentType" | "body" | "json">;

/** One response factory serves browser fetches and Server Component fetches. */
export async function mockApi(
  page: Page,
  next: NextFixture,
  matches: (url: URL) => boolean,
  respond: (request: Request) => MockResponse | Promise<MockResponse>,
) {
  next.onFetch(async request => {
    const url = new URL(request.url);
    // Server fetches call the backend directly, without the browser's /api prefix.
    if (!url.pathname.startsWith("/api/")) url.pathname = `/api${url.pathname}`;
    if (!matches(url)) return undefined;
    const result = await respond(new Request(url, request));
    const headers = new Headers(result.headers);
    if (result.contentType) headers.set("content-type", result.contentType);
    if (result.json !== undefined) return Response.json(result.json, { status: result.status, headers });
    return new Response(result.body as BodyInit | undefined, { status: result.status, headers });
  });
  await page.route(matches, async route => {
    const source = route.request();
    const body = source.postDataBuffer();
    const request = new Request(source.url(), {
      method: source.method(),
      headers: source.headers(),
      body: body ? new Uint8Array(body) : null,
    });
    await route.fulfill(await respond(request));
  });
}
