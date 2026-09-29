import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import type { components } from "../src/shared/generated/api-types";

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
const { SiteBanner }: typeof import("../src/app/SiteBanner") = require("../src/app/SiteBanner");

test.beforeEach(() => {
  banner = { ...campaign };
});

test.afterAll(() => {
  headersModule.exports = headers;
  bannerModule.exports = bannerApi;
});

test("the current school's city and form link reach the banner", async () => {
  const element = await SiteBanner({ schoolCity: "Montréal" });
  expect(element?.props).toMatchObject({ schoolCity: "Montréal", ctaHref: "/support-local" });
});

test("the enabled banner stays visible on every render without reading cookies", async () => {
  expect(await SiteBanner({ schoolCity: "Waterloo" })).not.toBeNull();
  expect(await SiteBanner({ schoolCity: "Waterloo" })).not.toBeNull();
  banner = { ...campaign, cta_href: "/another-announcement" };
  expect(await SiteBanner({ schoolCity: "Waterloo" })).not.toBeNull();
});

test("disabled banners and unsafe calls to action stay hidden", async () => {
  banner = null;
  expect(await SiteBanner({})).toBeNull();
  banner = { ...campaign, cta_href: "javascript:alert(1)" };
  expect(await SiteBanner({})).toBeNull();
  banner = { ...campaign, cta_href: "//unexpected.example" };
  expect(await SiteBanner({})).toBeNull();
});
