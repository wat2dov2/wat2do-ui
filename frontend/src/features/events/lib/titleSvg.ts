/**
 * Whether a poster's title drawing (`events.title_svg`) spells its event's
 * title, so a card can show the drawing in the title's place. A drawing that
 * left a word out (a sponsor set as a logo, say) or drew some other lettering
 * on the poster (a "WEEK AHEAD" header) would show the wrong title, so the
 * card sets the title as text instead.
 */

/** Short joining words a poster often drops or sets as a symbol. */
const JOINING_WORDS = new Set(["a", "an", "and", "at", "by", "de", "des", "du", "en", "et", "for", "in", "la", "le", "les", "of", "on", "the", "to", "vs", "with", "x"]);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

/** Letters and digits only, lower-cased and without accents, so "B A S K E T" reads as "basket". */
function letters(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Everything the drawing writes, its text and tspan contents run together. */
function drawnLetters(svg: string): string {
  const text = [...svg.matchAll(/>([^<>]*)</g)].map(([, content]) => content).join(" ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => ENTITIES[name.toLowerCase()] ?? entity);
  return letters(text);
}

export function titleSvgSpellsTitle(svg: string, title: string): boolean {
  const drawn = drawnLetters(svg);
  return title
    .split(/[\s/:|]+/)
    .map(letters)
    .filter(word => word.length > 1 && !JOINING_WORDS.has(word))
    .every(word => drawn.includes(word));
}

/** The drawing an event's title shows as, or null when it has none or it does not spell the title. */
export function eventTitleSvg(event: { title: string; title_svg?: string | null }): string | null {
  return event.title_svg && titleSvgSpellsTitle(event.title_svg, event.title) ? event.title_svg : null;
}

const TEXT_TAG = /<text\b([^>]*)>/g;
const number = (attributes: string, name: string) => {
  const match = new RegExp(`\\b${name}="(-?[\\d.]+)"`).exec(attributes);
  return match ? Number(match[1]) : null;
};

/**
 * The drawing moved sideways so its lettering sits in the middle of its view
 * box, as a centred card sets its title; a poster's title often stands off to
 * one side. Each line's width is its `textLength`, which the drawing rules ask
 * for on every line; a drawing without one is left as it is.
 */
export function centerTitleSvg(svg: string): string {
  const width = /viewBox="[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+[\d.]+"/.exec(svg)?.[1];
  const lines = [...svg.matchAll(TEXT_TAG)].map(([, attributes]) => {
    const x = number(attributes, "x");
    const length = number(attributes, "textLength");
    if (x === null || length === null) return null;
    const anchor = /\btext-anchor="(middle|end)"/.exec(attributes)?.[1];
    const left = anchor === "middle" ? x - length / 2 : anchor === "end" ? x - length : x;
    return [left, left + length] as const;
  });
  if (!width || lines.length === 0 || lines.some(line => line === null)) return svg;
  const left = Math.min(...lines.map(line => line![0]));
  const right = Math.max(...lines.map(line => line![1]));
  const shift = Number(width) / 2 - (left + right) / 2;
  if (Math.abs(shift) < 1) return svg;
  const open = /<svg\b[^>]*>/.exec(svg);
  const close = svg.lastIndexOf("</svg>");
  if (!open || close < 0) return svg;
  const start = open.index + open[0].length;
  return `${svg.slice(0, start)}<g transform="translate(${shift.toFixed(1)} 0)">${svg.slice(start, close)}</g>${svg.slice(close)}`;
}
