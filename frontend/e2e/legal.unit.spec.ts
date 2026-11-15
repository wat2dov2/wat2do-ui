import { expect, test } from "@playwright/test";
import english from "../src/features/legal/locales/en.json" with { type: "json" };
import { clubPayoutTermsValues, dataPolicyValues } from "../src/features/legal/lib/values";

/** Every {{placeholder}} a document's copy uses. */
function placeholders(node: unknown): Set<string> {
  const found = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/{{(\w+)}}/g)) found.add(match[1]);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  visit(node);
  return found;
}

test("every placeholder in the payout terms and the data policy has a value", () => {
  const documents = [
    [english.legal.clubPayoutTerms, clubPayoutTermsValues("en", ["University of Waterloo"])],
    [english.legal.dataPolicy, dataPolicyValues("en")],
  ] as const;
  for (const [copy, values] of documents) {
    for (const name of placeholders(copy)) {
      expect(values, `{{${name}}}`).toHaveProperty(name);
    }
  }
});

test("the payout terms write the control box's numbers out in the visitor's language", () => {
  const english = clubPayoutTermsValues("en", ["University of Waterloo"]);
  expect(english.rate).toBe("CA$2.00");
  expect(english.maxPerEventDate).toBe("CA$300.00");
  expect(english.payoutDay).toBe("15th");
  expect(english.deadlineDays).toBe("180 days");
  expect(english.opensHours).toBe("12 hours");
  expect(english.schools).toBe("University of Waterloo");
  expect(clubPayoutTermsValues("en", ["A", "B", "C"]).schools).toBe("A, B, and C");

  const french = clubPayoutTermsValues("fr", ["Université de Waterloo"]);
  expect(french.payoutDay).toBe("15");
  // French puts a narrow no-break space between the number and its unit.
  expect(french.disputeDays).toMatch(/^30\sjours$/);
  // Persian writes every number, the payout day included, in its own digits.
  expect(clubPayoutTermsValues("fa", ["دانشگاه واترلو"]).payoutDay).toBe("۱۵");
});

test("the data policy names its sign-in timings with their units", () => {
  const values = dataPolicyValues("en");
  expect(values.sessionDays).toBe("30 days");
  expect(values.codeMinutes).toBe("15 minutes");
  expect(values.inboxDays).toBe("90 days");
  expect(values.email).toContain("@");
});
