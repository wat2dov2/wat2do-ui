import type { Club, Event } from "@/shared/types";

/** An event with food that costs nothing, as the feed's Free food filter finds it. */
export function isFreeFoodEvent(event: Event): boolean {
  return (event.food?.length ?? 0) > 0 && !event.price;
}

/**
 * Words that mark a club as broad rather than niche: student governments and
 * faculty societies, cultural and faith associations, chapters of national
 * groups, and orientation teams.
 */
const BROAD_CLUB_NAME = /\b(society|societies|association|student|students|union|council|undergraduate|fellowship|ministry|chapter|federation|orientation|alumni|faculty|ensembles?|a cappella|choir|orchestra)\b/i;

/**
 * The niche clubs a student would not think to look for: hobby clubs (games
 * and recreation) with a logo and at least one event, whose names carry none
 * of the broad words. Shuffled, so each visit shows different ones.
 */
export function nicheClubs(clubs: readonly Club[], count: number): Club[] {
  const niche = clubs.filter((club) =>
    club.logo_url
    && (club.event_count ?? 0) > 0
    && club.categories.includes("Games & Recreation")
    && !BROAD_CLUB_NAME.test(club.club_name));
  const pool = niche.length >= count ? niche : clubs.filter((club) => club.logo_url);
  return [...pool]
    .map((club) => ({ club, order: Math.random() }))
    .sort((a, b) => a.order - b.order)
    .slice(0, count)
    .map(({ club }) => club);
}
