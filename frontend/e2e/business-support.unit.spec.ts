import { expect, test } from "@playwright/test";
import contactControl from "../../backend/controlbox/contact.json" with { type: "json" };
import {
  BUSINESS_SUPPORT_FIELD_LIMITS,
  buildBusinessSupportMessage,
  type BusinessSupportNomination,
} from "../src/features/contact/api/contact.api";
import type { SchoolSummary } from "../src/shared/api/schools.api";
import { nomination } from "./business-support-fixture";

const school: SchoolSummary = {
  slug: "uwaterloo",
  name: "University of Waterloo",
  city: "Waterloo",
  primary_color: "#ffcb05",
  secondary_color: "#000000",
  timezone: "America/Toronto",
  language: "en",
  faculties: [],
  event_seasons: [],
};

test.describe("message contract", () => {
  test("uses the existing email/message API and includes trimmed nomination plus city", () => {
    const payload = buildBusinessSupportMessage(nomination, school);

    expect(Object.keys(payload).sort()).toEqual(["email", "message"]);
    expect(payload.email).toBe("nominator@example.com");
    expect(payload.message).toContain("Business: Campus Corner Cafe");
    expect(payload.message).toContain("Location or address: 12 Main Street, Waterloo");
    expect(payload.message).toContain("Website or social link: https://example.com/cafe");
    expect(payload.message).toContain("Why support is needed:\nRoad construction");
    expect(payload.message).toContain("Suggested banner text:\nYour next coffee break");
    expect(payload.message).toContain("Estimated student visits per week: Not sure");
    expect(payload.message).toContain("Campus: University of Waterloo");
    expect(payload.message).toContain("City: Waterloo");
    expect(payload.message).not.toContain("  ");
  });

  test("omitted website and unavailable city do not invent a location", () => {
    const withoutCity = buildBusinessSupportMessage(
      { ...nomination, website: "   " }, { ...school, city: null },
    );
    expect(withoutCity.message).toContain("Website or social link: Not provided");
    expect(withoutCity.message).toContain("City: Not specified");
    expect(buildBusinessSupportMessage(nomination, undefined).message)
      .toContain("Campus: Not selected");
  });

  test("all form field maxima fit the shared contact message limit", () => {
    const maximumNomination = Object.fromEntries(
      Object.entries(BUSINESS_SUPPORT_FIELD_LIMITS).map(([field, limit]) => [field, "x".repeat(limit)]),
    ) as unknown as BusinessSupportNomination;
    const payload = buildBusinessSupportMessage(maximumNomination, school);
    expect(payload.message.length).toBeLessThanOrEqual(contactControl.maximum_message_length);
  });

  test("oversized final payload fails before the contact API can be called", () => {
    expect(() => buildBusinessSupportMessage({
      ...nomination,
      reasonForSupport: "x".repeat(contactControl.maximum_message_length),
    }, school)).toThrow(RangeError);
  });
});
