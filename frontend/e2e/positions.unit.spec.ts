import { expect, test } from "@playwright/test";
import { filterPositions } from "../src/features/positions/api/positionService";
import type { Position } from "../src/shared/types";

const filters = { search: "", positionType: "all" as const, addedSince: null };
const now = Date.parse("2026-09-30T12:00:00Z");
const position = (added_at: string, deadline_date: string | null = null) => ({
  id: 1, title: "Design lead", description: "Join our team", position_type: "committee",
  is_active: true, added_at, deadline_date,
}) as Position;

test("cached roles without a deadline disappear after four calendar months without inventing deadlines", () => {
  const stale = position("2026-05-30T11:59:59Z");
  const boundary = position("2026-05-30T12:00:00Z");
  expect(filterPositions([stale, boundary], filters, now)).toEqual([boundary]);
  expect(stale.deadline_date).toBeNull();
  expect(boundary.deadline_date).toBeNull();
});

test("known deadlines keep their own expiry rather than inheriting the undated age limit", () => {
  const open = position("2026-01-01T00:00:00Z", "2026-10-01");
  const closed = position("2026-09-01T00:00:00Z", "2026-09-29");
  expect(filterPositions([open, closed], filters, now)).toEqual([open]);
});


test("four-month expiry clamps short months and keeps the same UTC instant across DST", () => {
  const instant = Date.parse("2026-06-30T12:00:00Z");
  const before = position("2026-02-28T11:59:59Z");
  const boundary = position("2026-02-28T12:00:00Z");
  expect(filterPositions([before, boundary], filters, instant)).toEqual([boundary]);
});

test("cached position search, role type and arrival filters compose without mutating the directory", () => {
  const directory = [
    { ...position("2026-08-01T12:00:00Z", "2026-09-01"), title: "Design Lead", description: "Lead student campaigns." },
    { ...position("2026-08-02T12:00:00Z", "2026-09-05"), id: 2, title: "Operations Assistant", description: "Support room bookings.", position_type: "staff" as const },
  ];
  const filterTime = Date.parse("2026-08-02T18:00:00Z");
  expect(filterPositions(directory, { ...filters, search: "DESIGN" }, filterTime).map(item => item.id)).toEqual([1]);
  expect(filterPositions(directory, { ...filters, search: "room bookings" }, filterTime).map(item => item.id)).toEqual([2]);
  expect(filterPositions(directory, { ...filters, positionType: "staff" }, filterTime).map(item => item.id)).toEqual([2]);
  expect(filterPositions(directory, { ...filters, addedSince: "2026-08-01T18:00:00Z" }, filterTime).map(item => item.id)).toEqual([2]);
  expect(filterPositions(directory, filters, Date.parse("2026-09-06T12:00:00Z"))).toEqual([]);
  expect(directory.map(item => item.id)).toEqual([1, 2]);
});
