import { expect, test } from "@playwright/test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { components } from "../src/shared/generated/api-types";
import type { SiteBannerContent } from "../src/app/SiteBannerStrip";
import type { PartnerEventBanner, PartnerEventLink } from "../src/features/events/lib/partnerEventBanner";
import type { SchoolSummary } from "../src/shared/api/schools.api";
import frenchCopy from "../src/shared/locales/fr.json" with { type: "json" };

const require = createRequire(import.meta.url);
const headers = require("next/headers");
const headersModule = require.cache[require.resolve("next/headers")]!;
headersModule.exports = {
  ...headers,
  cookies: async () => { throw new Error("The banner must not read dismissal cookies"); },
};

const bannerApi = require("../src/shared/api/siteBanner.server");
const bannerModule = require.cache[require.resolve("../src/shared/api/siteBanner.server")]!;
type Banner = components["schemas"]["SiteBannerResponse"];
const campaign: Banner = {
  message_translation_key: "siteBanner.businessSupport.message",
  cta_label_translation_key: "siteBanner.businessSupport.cta",
  cta_href: "/support-local",
};
let banner: Banner | null = campaign;
bannerModule.exports = { ...bannerApi, getSiteBanner: async () => banner };

const feedApi = require("../src/features/events/api/eventFeed.server");
const feedModule = require.cache[require.resolve("../src/features/events/api/eventFeed.server")]!;
// Dip & Drink's Saturday at the bazaar, 11 AM-8 PM Toronto time, in a year it is never today.
const post = "https://www.instagram.com/p/Df-NENRThhG/";
const popUp: PartnerEventBanner = {
  partnerName: "Dip & Drink",
  discountPercent: 20,
  discountCode: "WAT2DO",
  link: { kind: "instagramPost", href: post },
  venue: "Victoria Park Hub",
  occurrence: { dtstart_utc: "2030-11-23T16:00:00Z", dtend_utc: "2030-11-24T01:00:00Z" },
};
let partnerEvent: PartnerEventBanner | null = null;
const partnerLookups: string[] = [];
feedModule.exports = {
  ...feedApi,
  getSchoolPartnerEventBanner: async (school: string) => {
    partnerLookups.push(school);
    return partnerEvent;
  },
};

require("../src/app/english-locale");
const i18n: typeof import("../src/shared/lib/i18n").default = require("../src/shared/lib/i18n").default;
const { Trans }: typeof import("react-i18next") = require("react-i18next");
const { SiteBanner }: typeof import("../src/app/SiteBanner") = require("../src/app/SiteBanner");

// Playwright's JSX transform creates browser component-test descriptors, so the
// strip is compiled with the real React JSX runtime to render it, on the Events page.
const { outputText } = ts.transpileModule(
  readFileSync(new URL("../src/app/SiteBannerStrip.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } },
);
const stripModule = { exports: {} as typeof import("../src/app/SiteBannerStrip") };
runInNewContext(outputText, {
  exports: stripModule.exports,
  require: (id: string) => {
    // The strip measures itself in a layout effect, which a server render skips anyway.
    if (id === "react") return { ...require("react"), useLayoutEffect: require("react").useEffect };
    if (id === "next/navigation") return { usePathname: () => "/events", useRouter: () => ({}) };
    // The app's own i18n instance, with its real English and French copy.
    if (id === "react-i18next") {
      return {
        useTranslation: () => ({ t: i18n.t.bind(i18n), i18n }),
        Trans: (props: object) => createElement(Trans, { ...props, i18n }),
      };
    }
    if (id === "@/app/hooks/useAppNavigation") return { prefetchPublicPage() {} };
    if (id === "@/shared/ui/link") {
      return {
        Link: ({ href, target, rel, children }: { href: string; target?: string; rel?: string; children: ReactNode }) =>
          createElement("a", { href, target, rel }, children),
      };
    }
    if (id.startsWith("@/")) return require(new URL(`../src/${id.slice(2)}`, import.meta.url).pathname);
    return require(id);
  },
});
const { SiteBannerStrip } = stripModule.exports;

const school = (slug: string, name: string): SchoolSummary => ({
  slug,
  name,
  primary_color: "#004C9B",
  secondary_color: "#FFDC00",
  timezone: "America/Toronto",
  language: "en",
});
const mcgill = school("mcgill", "McGill University");
const tmu = school("tmu", "Toronto Metropolitan University");

test.beforeEach(async () => {
  banner = { ...campaign };
  partnerEvent = null;
  partnerLookups.length = 0;
  await i18n.changeLanguage("en");
});

test.afterAll(() => {
  headersModule.exports = headers;
  bannerModule.exports = bannerApi;
  feedModule.exports = feedApi;
});

test("the current school's full name and form link reach the banner", async () => {
  const element = await SiteBanner({ school: mcgill });
  expect(element?.props).toMatchObject({
    content: { kind: "announcement", schoolName: "McGill University" },
    ctaHref: "/support-local",
  });
  expect(partnerLookups).toEqual(["mcgill"]);
});

test("the enabled banner stays visible on every render without reading cookies", async () => {
  expect(await SiteBanner({ school: mcgill })).not.toBeNull();
  expect(await SiteBanner({ school: mcgill })).not.toBeNull();
  banner = { ...campaign, cta_href: "/another-announcement" };
  expect(await SiteBanner({ school: mcgill })).not.toBeNull();
});

test("disabled banners and unsafe calls to action stay hidden", async () => {
  banner = null;
  expect(await SiteBanner({})).toBeNull();
  banner = { ...campaign, cta_href: "javascript:alert(1)" };
  expect(await SiteBanner({})).toBeNull();
  banner = { ...campaign, cta_href: "//unexpected.example" };
  expect(await SiteBanner({})).toBeNull();
});

test("a partner's event due at the school takes the global banner's place until none is", async () => {
  partnerEvent = popUp;
  const element = await SiteBanner({ school: tmu });
  expect(element?.props).toEqual({
    content: {
      kind: "partnerEvent",
      partnerName: "Dip & Drink",
      discountPercent: 20,
      discountCode: "WAT2DO",
      venue: "Victoria Park Hub",
      occurrence: popUp.occurrence,
      timeZone: "America/Toronto",
      linksTo: "instagramPost",
    },
    ctaHref: post,
  });
  // An event read from anywhere but an Instagram post links to its page here.
  partnerEvent = { ...popUp, link: { kind: "eventPage", href: "/events/47001" } };
  expect((await SiteBanner({ school: tmu }))?.props).toMatchObject({
    content: { kind: "partnerEvent", linksTo: "eventPage" },
    ctaHref: "/events/47001",
  });
  partnerEvent = null;
  expect((await SiteBanner({ school: tmu }))?.props.content.kind).toBe("announcement");
  // A partner event shows even while the global banner is off.
  banner = null;
  partnerEvent = popUp;
  expect((await SiteBanner({ school: tmu }))?.props.content.kind).toBe("partnerEvent");
});

const renderStrip = (content: SiteBannerContent, ctaHref = post) =>
  renderToStaticMarkup(createElement(SiteBannerStrip, { content, ctaHref }));
const partnerStrip = (
  venue: string | null,
  linksTo: PartnerEventLink["kind"] = "instagramPost",
): SiteBannerContent => ({
  kind: "partnerEvent",
  partnerName: popUp.partnerName,
  discountPercent: popUp.discountPercent,
  discountCode: popUp.discountCode,
  venue,
  occurrence: popUp.occurrence,
  timeZone: "America/Toronto",
  linksTo,
});
/** A link to the partner's post, which opens in a new tab without telling Instagram where it came from. */
const postLink = (text: string) => `<a href="${post}" target="_blank" rel="noopener noreferrer">${text}</a>`;

test("the partner strip names the date, the venue alone and the code, and links the partner's name to its post", () => {
  expect(renderStrip(partnerStrip("Victoria Park Hub"))).toContain(
    `<p>${postLink("Dip &amp; Drink")} pop-up: Saturday, Nov 23, 11:00 AM-8:00 PM at Victoria Park Hub. 20% off with code WAT2DO. ${postLink("See the post")}</p>`,
  );
  expect(renderStrip(partnerStrip(null))).toContain(
    `<p>${postLink("Dip &amp; Drink")} pop-up: Saturday, Nov 23, 11:00 AM-8:00 PM. 20% off with code WAT2DO. ${postLink("See the post")}</p>`,
  );
});

test("without a post on Instagram, the partner's name and the call to action open the event's page here", () => {
  expect(renderStrip(partnerStrip("Victoria Park Hub", "eventPage"), "/events/47001")).toContain(
    '<p><a href="/events/47001">Dip &amp; Drink</a> pop-up: Saturday, Nov 23, 11:00 AM-8:00 PM at Victoria Park Hub. 20% off with code WAT2DO. <a href="/events/47001">See the event</a></p>',
  );
});

test("a venue read from a post shows as its own text and never adds markup", () => {
  const markup = renderStrip(partnerStrip('<partnerLink href="https://evil.test">Free</partnerLink> & <b>more</b>'));
  expect(markup).toContain(
    "at &lt;partnerLink href=&quot;https://evil.test&quot;&gt;Free&lt;/partnerLink&gt; &amp; &lt;b&gt;more&lt;/b&gt;. 20% off",
  );
  expect(markup.match(/<a /g)).toHaveLength(2);
});

test("the partner strip follows the visitor's language and its date and number formats", async () => {
  i18n.addResourceBundle("fr", "translation", frenchCopy, true, true);
  await i18n.changeLanguage("fr");
  const markup = renderStrip(partnerStrip("Victoria Park Hub")).replace(/[\u00a0\u202f]/g, " ");
  expect(markup).toContain(
    `Pop-up ${postLink("Dip &amp; Drink")} : samedi 23 nov., 11:00-20:00, Victoria Park Hub. 20 % de réduction avec le code WAT2DO. ${postLink("Voir la publication")}`,
  );
});
