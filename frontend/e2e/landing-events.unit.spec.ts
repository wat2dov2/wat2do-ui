import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Club = { club_name: string; logo_url?: string | null; event_count?: number; categories: string[] };
type LandingEvents = {
  isFreeFoodEvent: (event: object) => boolean;
  nicheClubs: (clubs: readonly Club[], count: number) => Club[];
};

function loadLandingEvents(): LandingEvents {
  const source = readFileSync(new URL("../src/features/landing/lib/landingEvents.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } });
  const exports = {} as LandingEvents;
  runInNewContext(outputText, { exports, Math });
  return exports;
}

test("free food is food that costs nothing", () => {
  const { isFreeFoodEvent } = loadLandingEvents();
  expect(isFreeFoodEvent({ food: ["Pizza"], price: null })).toBe(true);
  expect(isFreeFoodEvent({ food: ["Pizza"], price: 5 })).toBe(false);
  expect(isFreeFoodEvent({ food: null, price: null })).toBe(false);
});

test("the clubs preview picks niche hobby clubs, never broad societies or associations", () => {
  const { nicheClubs } = loadLandingEvents();
  const club = (club_name: string, categories = ["Games & Recreation"], event_count = 3): Club => ({ club_name, logo_url: "logo.png", event_count, categories });
  const clubs = [
    club("Campus Crusade for Cheese"),
    club("Motorcycle Club"),
    club("Engineering Society"),
    club("Accounting and Finance Student Association", ["Business"]),
    club("A Cappella Club", ["Arts & Culture"]),
    club("Archery Club", ["Games & Recreation"], 0),
  ];
  const picked = nicheClubs(clubs, 2).map((entry) => entry.club_name).sort();
  expect(picked).toEqual(["Campus Crusade for Cheese", "Motorcycle Club"]);
});
