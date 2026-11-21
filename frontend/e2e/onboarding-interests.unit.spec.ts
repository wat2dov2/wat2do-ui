import { expect, test } from "@playwright/test";
import { onboardingInterests } from "../src/features/onboarding/utils/onboardingInterests";

test("onboarding saves the picked topics plus the tapped events' categories, each once", () => {
  expect(onboardingInterests(
    ["Business", "Health"],
    [{ category: "Health" }, { category: "Arts & Culture" }, { category: "Arts & Culture" }],
  )).toEqual(["Business", "Health", "Arts & Culture"]);
  expect(onboardingInterests([], [])).toEqual([]);
});
