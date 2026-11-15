import { expect, test } from "@playwright/test";
import { analyticsUrl, startAnalytics, trackPageView } from "../src/shared/lib/analytics";
import { getRouteDocumentTitle } from "../src/shared/constants/routes";

const SITE = "https://uwaterloo.wat2do.io";
const TICKET_CODE = "7KQ2MZ4PABCDEFGHIJKLMNOP";
const UUID = "0b6f8f1e-2c4d-4e7a-9f00-1a2b3c4d5e6f";

/** Pages whose path carries a secret or names a person, and what GA may see of each. */
const PRIVATE_PAGES = [
  [`/tickets/${TICKET_CODE}`, "/tickets/:code"],
  [`/tickets/orders/${UUID}`, "/tickets/orders/:orderId"],
  [`/invite/${UUID}`, "/invite/:token"],
  [`/claim/${UUID}`, "/claim/:token"],
  [`/qr/${UUID}`, "/qr/:code"],
] as const;

test.describe("what Google Analytics may see of a page", () => {
  test("a sign-in link keeps none of its query", () => {
    expect(
      analyticsUrl(`${SITE}/auth/callback?token=4f1c9e2b&email=ada%40uwaterloo.ca&returnTo=%2Ftickets%2F${TICKET_CODE}`),
    ).toBe(`${SITE}/auth/callback`);
  });

  test("tickets, orders, invitations, claim links and poster codes keep only their route", () => {
    for (const [path, seen] of PRIVATE_PAGES) {
      expect(analyticsUrl(`${SITE}${path}`), path).toBe(`${SITE}${seen}`);
      // A trailing slash, a query, a fragment or a mistyped case changes nothing.
      expect(analyticsUrl(`${SITE}${path.toUpperCase()}/?refund=1#top`), path).toBe(`${SITE}${seen}`);
      expect(analyticsUrl(`${SITE}/${path}/extra`), path).toBe(`${SITE}${seen}`);
    }
    expect(analyticsUrl(`${SITE}/tickets/orders/${UUID}?session_id=cs_test_a1b2c3`)).toBe(
      `${SITE}/tickets/orders/:orderId`,
    );
  });

  test("their page titles never carry the secret either", () => {
    for (const [path] of PRIVATE_PAGES) {
      const secret = path.split("/").at(-1)!;
      expect(getRouteDocumentTitle(path), path).not.toContain(secret);
    }
  });

  test("other pages keep their path, and only the campaign tags of their query", () => {
    expect(analyticsUrl(`${SITE}/tickets`)).toBe(`${SITE}/tickets`);
    expect(analyticsUrl(`${SITE}/clubs/42#events`)).toBe(`${SITE}/clubs/42`);
    expect(analyticsUrl(`${SITE}/login?returnTo=%2Finvite%2F${UUID}`)).toBe(`${SITE}/login`);
    expect(
      analyticsUrl(`${SITE}/events/7?utm_source=poster&poster_id=p-1&utm_campaign=fall&school=uwaterloo`),
    ).toBe(`${SITE}/events/7?utm_source=poster&utm_campaign=fall`);
  });

  test("a referrer keeps only its origin and path, and no referrer stays empty", () => {
    expect(analyticsUrl("https://l.instagram.com/?u=https%3A%2F%2Fwat2do.io%2Fclaim%2Fabc&e=AT0")).toBe(
      "https://l.instagram.com/",
    );
    expect(analyticsUrl("")).toBe("");
  });
});

test.describe("the page views Google Analytics receives", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  test.afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  });

  test("gtag.js sends none of its own, and each one recorded is sanitized", () => {
    const dataLayer: unknown[] = [];
    Object.defineProperty(globalThis, "window", { value: { dataLayer }, configurable: true, writable: true });

    startAnalytics("G-TEST");
    const first = trackPageView(`${SITE}/tickets/${TICKET_CODE}?refund=1`, "https://mail.google.com/mail/u/0/?pli=1#inbox");
    trackPageView(`${SITE}/events?school=uwaterloo`, first);

    // gtag.js runs only arguments objects, the way Google's snippet pushes them.
    for (const entry of dataLayer) {
      expect(Object.prototype.toString.call(entry)).toBe("[object Arguments]");
    }
    const commands = dataLayer.map((entry) => Array.from(entry as ArrayLike<unknown>));
    expect(commands[0][0]).toBe("js");
    expect(commands[0][1]).toBeInstanceOf(Date);
    const ticket = { page_location: `${SITE}/tickets/:code`, page_referrer: "https://mail.google.com/mail/u/0/" };
    const events = { page_location: `${SITE}/events`, page_referrer: `${SITE}/tickets/:code` };
    expect(commands.slice(1)).toEqual([
      ["config", "G-TEST", { send_page_view: false }],
      ["set", ticket],
      ["event", "page_view", ticket],
      ["set", events],
      ["event", "page_view", events],
    ]);
  });
});
