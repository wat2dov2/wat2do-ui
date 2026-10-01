import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const originals = new Map<string, unknown>();
for (const [path, symbol] of [
  ["../src/shared/api/schools.server", "getSchoolDirectory"],
  ["../src/features/events/api/eventFeed.server", "getSchoolBrowseSnapshot"],
  ["../src/features/positions/api/positionDirectory.server", "getPositionDirectorySnapshot"],
  ["../src/features/clubs/api/clubDirectory.server", "getClubDirectorySnapshot"],
]) {
  require(path);
  const module = require.cache[require.resolve(path)]!;
  originals.set(path, module.exports);
  module.exports = { ...module.exports, [symbol]: async (school: string) => symbol === "getSchoolDirectory"
    ? [{ slug: "uwaterloo" }, { slug: "uwo" }]
    : { items: [{ school }], generated_at: 123 } };
}
const { GET } = require("../src/app/api/discovery/route") as typeof import("../src/app/api/discovery/route");
for (const [path, exports] of originals) require.cache[require.resolve(path)]!.exports = exports;
const { NextRequest } = require("next/server");

test("public snapshots are CDN-cacheable and remain explicitly school-scoped", async () => {
  for (const school of ["uwaterloo", "uwo"]) {
    const response = await GET(new NextRequest(`http://localhost/api/discovery?school=${school}&resource=clubs`));
    expect(response.headers.get("cache-control")).toContain("public, max-age=0, s-maxage=60");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ items: [{ school }], generated_at: 123 });
  }
});

test("invalid discovery requests are not published as cacheable catalogs", async () => {
  const response = await GET(new NextRequest("http://localhost/api/discovery?school=unknown&resource=clubs"));
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).not.toContain("public");
});
