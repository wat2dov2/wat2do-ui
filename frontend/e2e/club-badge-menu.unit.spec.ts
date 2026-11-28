import { expect, test } from "@playwright/test";
import { clubBadgeMenuClubs } from "../src/features/clubs/lib/clubBadgeMenu";

const HOST = { id: 4, name: "UW Design Club", logoUrl: "https://media.example.test/design.png" };

test.describe("club badge menu", () => {
  test("lists the host first, then every cohost, each with its logo", () => {
    expect(clubBadgeMenuClubs(HOST, [
      { id: 7, club_name: "UW Operations Club", logo_url: null },
      { id: 9, club_name: "UW Finance Club", logo_url: "https://media.example.test/finance.png" },
    ])).toEqual([
      { id: 4, name: "UW Design Club", logoUrl: "https://media.example.test/design.png" },
      { id: 7, name: "UW Operations Club", logoUrl: null },
      { id: 9, name: "UW Finance Club", logoUrl: "https://media.example.test/finance.png" },
    ]);
  });

  test("a badge for one club has no menu, so it links straight to that club", () => {
    expect(clubBadgeMenuClubs(HOST, [])).toEqual([]);
  });

  test("a host with no page has no menu, so the badge stays inert", () => {
    const cohosts = [{ id: 7, club_name: "UW Operations Club" }];
    expect(clubBadgeMenuClubs({ ...HOST, id: null }, cohosts)).toEqual([]);
    expect(clubBadgeMenuClubs({ ...HOST, id: undefined }, cohosts)).toEqual([]);
    expect(clubBadgeMenuClubs({ ...HOST, name: "" }, cohosts)).toEqual([]);
  });

  test("a host without a logo still gets a row", () => {
    expect(clubBadgeMenuClubs({ id: 4, name: "UW Design Club" }, [{ id: 7, club_name: "UW Operations Club" }])[0])
      .toEqual({ id: 4, name: "UW Design Club", logoUrl: null });
  });
});
