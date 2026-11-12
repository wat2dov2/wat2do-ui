import { expect, test } from "@playwright/test";
import { centerTitleSvg, eventTitleSvg, titleSvgSpellsTitle } from "../src/features/events/lib/titleSvg";

const svg = (...lines: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120">${lines.map(line => `<text>${line}</text>`).join("")}</svg>`;

test("a drawing that spells the whole title stands in for it", () => {
  expect(titleSvgSpellsTitle(svg("JOIN US FOR", "NETWORKING WITH KPMG"), "Join us for Networking with KPMG")).toBe(true);
  // Letter-spaced lettering, stacked shadows, curly apostrophes and accents all still spell it.
  expect(titleSvgSpellsTitle(svg("RUSH CUP", "B A S K E T B A L L"), "Rush Cup Basketball")).toBe(true);
  expect(titleSvgSpellsTitle(svg("BROTHERS’ GAMING", "BROTHERS’ GAMING", "NIGHT"), "Brothers' Gaming Night")).toBe(true);
  expect(titleSvgSpellsTitle(svg("RANDO- REFUGE DE L’AÉGUL"), "Rando-Refuge de l'Aégul")).toBe(true);
  expect(titleSvgSpellsTitle(svg("Mac &amp; Cheese Night"), "Mac & Cheese Night")).toBe(true);
  // Joining words the poster drops or sets as a symbol do not count.
  expect(titleSvgSpellsTitle(svg("NouLa x Le Gym 3v3", "BASKETBALL TOURNAMENT"), "NouLa x Le Gym 3v3 Basketball Tournament")).toBe(true);
});

test("a drawing that leaves a word out or draws other lettering gives way to the title as text", () => {
  // A sponsor set as a logo, left out of the drawing.
  expect(titleSvgSpellsTitle(svg("JOIN US FOR", "NETWORKING WITH"), "Join us for Networking with KPMG")).toBe(false);
  expect(titleSvgSpellsTitle(svg("Innov 8"), "Innov8 with KPMG Case Competition")).toBe(false);
  // The poster's header, not the event's title.
  expect(titleSvgSpellsTitle(svg("WEEK AHEAD"), "Brock Men's Hockey vs Guelph")).toBe(false);
  expect(titleSvgSpellsTitle(svg("TGIF"), "TGIF Free Waffles")).toBe(false);
});

test("a drawing standing off to one side is moved to the middle of its view box", () => {
  // UBC's Copa América: both lines start at x=218 and run 150 wide in a 400-wide box.
  const copa = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 108"><text x="218" y="50" textLength="150">COPA</text><text x="218" y="100" textLength="150">AMERICA</text></svg>`;
  expect(centerTitleSvg(copa)).toContain(`<g transform="translate(-93.0 0)">`);
  // Lines anchored at their middle or end are measured from there.
  const centred = `<svg viewBox="0 0 400 80"><text x="200" text-anchor="middle" textLength="300">FALL FORMAL</text></svg>`;
  expect(centerTitleSvg(centred)).toBe(centred);
  const ending = `<svg viewBox="0 0 400 80"><text x="390" text-anchor="end" textLength="200">GAME</text></svg>`;
  expect(centerTitleSvg(ending)).toContain(`translate(-90.0 0)`);
  // A line takes its anchor from a group around it: CPANSEF's lines are centred by their group, so they stay.
  const grouped = `<svg viewBox="0 0 400 150"><g font-size="54" text-anchor="middle"><text x="200" y="62" textLength="380">CPANSEF CASE</text><text x="200" y="130" textLength="362">COMPETITION</text></g></svg>`;
  expect(centerTitleSvg(grouped)).toBe(grouped);
  const styled = `<svg viewBox="0 0 400 80"><g style="text-anchor: middle"><text x="200" textLength="300">GAME</text></g></svg>`;
  expect(centerTitleSvg(styled)).toBe(styled);
  // A line's own anchor wins over its group's, and the group's ends with the group.
  const own = `<svg viewBox="0 0 400 120"><g text-anchor="middle"><text x="40" text-anchor="start" textLength="300">GAME</text></g><text x="40" textLength="300">NIGHT</text></svg>`;
  expect(centerTitleSvg(own)).toContain(`translate(10.0 0)`);
  // A line with no width cannot be measured, so the drawing stays as drawn.
  const unmeasured = `<svg viewBox="0 0 400 80"><text x="10">GAME</text></svg>`;
  expect(centerTitleSvg(unmeasured)).toBe(unmeasured);
});

test("an event shows its drawing only when the drawing spells its title", () => {
  const drawing = svg("NETWORKING WITH KPMG");
  expect(eventTitleSvg({ title: "Networking with KPMG", title_svg: drawing })).toBe(drawing);
  expect(eventTitleSvg({ title: "Networking with KPMG", title_svg: svg("NETWORKING WITH") })).toBeNull();
  expect(eventTitleSvg({ title: "Networking with KPMG", title_svg: null })).toBeNull();
});
