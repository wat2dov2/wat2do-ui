import { expect, test } from "@playwright/test";
import { dayWindow, shiftDay, todayValue } from "../src/features/admin/lib/automatedFollows";

test("a day's window runs from the admin's local midnight to the next one", () => {
  expect(dayWindow("2026-11-23")).toEqual({
    since: new Date(2026, 10, 23).toISOString(),
    until: new Date(2026, 10, 24).toISOString(),
  });
  // The day a clock change falls on is as long as the admin's clock says.
  const { since, until } = dayWindow("2026-11-01");
  expect(Date.parse(until) - Date.parse(since)).toBe(new Date(2026, 10, 2).getTime() - new Date(2026, 10, 1).getTime());
});

test("days step across month and year ends", () => {
  expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01");
  expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
  expect(todayValue(new Date(2026, 10, 23, 23, 59))).toBe("2026-11-23");
});
