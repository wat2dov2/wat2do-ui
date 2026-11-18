import { expect, test } from "@playwright/test";
import sharp from "sharp";
import socialPreviews from "../../backend/controlbox/social_previews.json" with { type: "json" };
import type { School } from "../src/shared/api/schools.api";
import {
  BRAND_SHARE_IMAGE,
  buildBrandStructuredData,
  buildSchoolPageMetadata,
  selectSeoImage,
  type SchoolPage,
} from "../src/shared/lib/seo";

const image = {
  url: "https://uwaterloo.wat2do.io/og-image.png?v=abc",
  alt: "University of Waterloo · 195 upcoming events · Wat2Do",
};
const school = (slug: string, name: string, city: string | null, language: School["language"] = "en"): School => ({
  slug, name, city, language, primary_color: "#000000", secondary_color: "#FED34C", timezone: "America/Toronto",
});
const waterloo = school("uwaterloo", "University of Waterloo", "Waterloo");
const montreal = school("udem", "Université de Montréal", "Montréal", "fr");
const pages: SchoolPage[] = ["events", "clubs", "positions", "landing"];

/** The title, description, canonical and Open Graph locale a school page declares. */
function snippet(page: SchoolPage, record: School | null, slug = record?.slug ?? "uwaterloo") {
  const metadata = buildSchoolPageMetadata({ page, school: slug, schoolRecord: record, image, index: true });
  return {
    title: (metadata.title as { absolute: string }).absolute,
    description: metadata.description,
    canonical: metadata.alternates?.canonical,
    locale: (metadata.openGraph as { locale?: string }).locale,
  };
}

test("Waterloo's pages say what a student gets there, on the school's own host", () => {
  expect(snippet("events", waterloo)).toEqual({
    title: "University of Waterloo Events, Free Food & Parties | Wat2Do",
    description: "University of Waterloo club events in one place: free food, parties, workshops, career nights and more things to do around Waterloo. Updated daily.",
    canonical: "https://uwaterloo.wat2do.io/events",
    locale: "en_US",
  });
  expect(snippet("clubs", waterloo)).toMatchObject({
    title: "University of Waterloo Clubs & Student Groups | Wat2Do",
    canonical: "https://uwaterloo.wat2do.io/clubs",
  });
  expect(snippet("positions", waterloo)).toMatchObject({
    title: "University of Waterloo Club Positions & Exec Roles | Wat2Do",
    canonical: "https://uwaterloo.wat2do.io/positions",
  });
  expect(snippet("landing", waterloo)).toMatchObject({
    title: "Every University of Waterloo Event in One Place | Wat2Do",
    canonical: "https://uwaterloo.wat2do.io/landing",
  });
});

test("French schools get French titles and descriptions, with the article elided before a vowel", () => {
  expect(snippet("events", montreal)).toEqual({
    title: "Événements et activités à l'Université de Montréal | Wat2Do",
    description: "Les événements des clubs de l'Université de Montréal au même endroit : bouffe gratuite, partys, ateliers, soirées réseautage et plus. Mis à jour chaque jour.",
    canonical: "https://udem.wat2do.io/events",
    locale: "fr_CA",
  });
  expect(snippet("clubs", montreal).title).toBe("Clubs et associations de l'Université de Montréal | Wat2Do");
  expect(snippet("positions", montreal).title).toBe("Postes dans les clubs de l'Université de Montréal | Wat2Do");
  expect(snippet("landing", montreal).title).toBe("Tous les événements de l'Université de Montréal | Wat2Do");

  const memorial = school("mun", "Memorial University of Newfoundland", "St. John's", "fr");
  expect(snippet("events", memorial).title).toBe("Événements à Memorial University of Newfoundland | Wat2Do");
});

test("a long school name falls back to a shorter title instead of running past the limit", () => {
  const mit = school("mit", "Massachusetts Institute of Technology", "Cambridge");
  expect(snippet("events", mit).title).toBe("Massachusetts Institute of Technology Events | Wat2Do");
  expect(snippet("positions", mit).title).toBe("Massachusetts Institute of Technology Club Roles | Wat2Do");
  // A school without a city keeps the campus wording.
  expect(snippet("events", school("x", "Brock University", null)).description).toBe(
    "Brock University club events in one place: free food, parties, workshops, career nights and more things to do on campus. Updated daily.",
  );
});

test("a school the directory cannot return keeps English copy under its slug", () => {
  expect(snippet("events", null, "uwaterloo")).toMatchObject({
    title: "uwaterloo Events, Free Food & Parties | Wat2Do",
    canonical: "https://uwaterloo.wat2do.io/events",
    locale: "en_US",
  });
});

test("every school's copy fits a search result, with no live counts, stock verbs or em dashes", () => {
  const names: Array<[string, School["language"]]> = [
    ["Brock University", "en"], ["Carleton University", "en"], ["Columbia University", "en"],
    ["Concordia University", "en"], ["Cornell University", "en"], ["Dalhousie University", "en"],
    ["Massachusetts Institute of Technology", "en"], ["McGill University", "en"], ["McMaster University", "en"],
    ["Memorial University of Newfoundland", "fr"], ["New York University", "en"], ["OCAD University", "en"],
    ["Ontario Tech University", "en"], ["Queen's University", "en"], ["Simon Fraser University", "en"],
    ["Toronto Metropolitan University", "en"], ["University of Alberta", "en"], ["University of British Columbia", "en"],
    ["University of Calgary", "en"], ["University of California, Berkeley", "en"], ["University of Guelph", "en"],
    ["University of Manitoba", "en"], ["University of Michigan", "en"], ["University of Ottawa", "en"],
    ["University of Pennsylvania", "en"], ["University of Saskatchewan", "en"], ["University of Toronto Mississauga", "en"],
    ["University of Toronto Scarborough", "en"], ["University of Toronto St. George", "en"], ["University of Waterloo", "en"],
    ["University of Western Ontario", "en"], ["University of Windsor", "en"], ["Université de Montréal", "fr"],
    ["Université du Québec à Montréal", "fr"], ["Université Laval", "fr"], ["Wilfrid Laurier University", "en"],
    ["York University", "en"],
  ];
  for (const [name, language] of names) {
    for (const page of pages) {
      const { title, description } = snippet(page, school("x", name, "Toronto", language));
      expect(title.length, title).toBeLessThanOrEqual(socialPreviews.title_max_characters);
      expect(description!.length, description!).toBeLessThanOrEqual(socialPreviews.description_max_characters);
      expect(title.replaceAll("Wat2Do", ""), title).not.toMatch(/\d/);
      expect(`${title} ${description}`, title).not.toMatch(/\b(Discover|Explore|Browse)\b|\u2014/i);
    }
  }
});

test("the brand's structured data names Wat2Do, its logo and every school's Instagram account", () => {
  const data = buildBrandStructuredData([{ slug: "uwaterloo" }, { slug: "udem" }]);
  expect(data).toEqual({
    "@context": "https://schema.org",
    "@graph": [
      expect.objectContaining({
        "@type": "Organization",
        "@id": "https://wat2do.io/#organization",
        name: "Wat2Do",
        url: "https://wat2do.io/",
        logo: { "@type": "ImageObject", url: "https://wat2do.io/icon-512.png", width: 512, height: 512 },
        sameAs: [
          "https://www.linkedin.com/company/wat2do/",
          "https://www.instagram.com/wat2do.uwaterloo/",
          "https://www.instagram.com/wat2do.udem/",
        ],
      }),
      expect.objectContaining({
        "@type": "WebSite",
        "@id": "https://wat2do.io/#website",
        name: "Wat2Do",
        url: "https://wat2do.io/",
        publisher: { "@id": "https://wat2do.io/#organization" },
      }),
    ],
  });
});

test("a page without a usable image of its own shares Wat2Do's card", async () => {
  const card = await sharp(new URL("../public/images/brand/wat2do-share.png", import.meta.url).pathname).metadata();
  expect(card).toMatchObject({ format: "png", width: BRAND_SHARE_IMAGE.width, height: BRAND_SHARE_IMAGE.height });
  expect(BRAND_SHARE_IMAGE).toEqual({
    url: "https://wat2do.io/images/brand/wat2do-share.png",
    alt: "Wat2Do",
    width: 1200,
    height: 630,
    type: "image/png",
  });
  expect(selectSeoImage(null, "Poster")).toBe(BRAND_SHARE_IMAGE);
  expect(selectSeoImage("data:image/png;base64,AAAA", "Poster")).toBe(BRAND_SHARE_IMAGE);
  expect(selectSeoImage("https://media.wat2do.io/a.jpg", "Poster")).toEqual({ url: "https://media.wat2do.io/a.jpg", alt: "Poster" });
});
