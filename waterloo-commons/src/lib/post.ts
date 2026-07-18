import type { Json } from "@/lib/database.types";
import {
  assertExactJsonKeys,
  readJsonObject,
  readJsonString,
  readJsonStringArray,
} from "@/lib/json-contract";

export interface CommonsPost {
  title: string;
  hostOrg: string;
  badge: string;
  pills: string[];
  venue: string;
  dateLine: string;
  timeLine: string;
  caption: string;
}

export const COMMONS_POST_FIELD_LIMITS = {
  title: 70,
  hostOrg: 80,
  badge: 16,
  pill: 24,
  venue: 80,
  dateLine: 40,
  timeLine: 40,
  caption: 2400,
} as const;

export const MAX_COMMONS_POST_PILLS = 5;

const COMMONS_POST_KEYS = [
  "title",
  "hostOrg",
  "badge",
  "pills",
  "venue",
  "dateLine",
  "timeLine",
  "caption",
] as const;

export function parseCommonsPost(value: Json): CommonsPost {
  const post = readJsonObject(value, "submission post");
  return {
    title: readJsonString(post, "title", "submission post"),
    hostOrg: readJsonString(post, "hostOrg", "submission post"),
    badge: readJsonString(post, "badge", "submission post"),
    pills: readJsonStringArray(post, "pills", "submission post"),
    venue: readJsonString(post, "venue", "submission post"),
    dateLine: readJsonString(post, "dateLine", "submission post"),
    timeLine: readJsonString(post, "timeLine", "submission post"),
    caption: readJsonString(post, "caption", "submission post"),
  };
}

export const DEFAULT_POST: CommonsPost = {
  title: "Canvas\nDesignathon",
  hostOrg: "UW Blueprint",
  badge: "MAKE",
  pills: ["REG. REQUIRED", "CASH PRIZES", "FREE BOBA"],
  venue: "Accelerator Centre",
  dateLine: "SUN, NOV 16",
  timeLine: "9:00 AM - 6:30 PM",
  caption: `CANVAS DESIGNATHON - hosted by UW Blueprint

🗓️ Sun, Nov 16 @ 9:00 AM - 6:30 PM
📍 Accelerator Centre

Build for a cause at UW Blueprint's Canvas Designathon. Bring your ideas, meet the team, and compete for prizes over a day of making.

RSVP + more events on wat2do.ca`,
};

export function normalisePost(value: unknown): CommonsPost {
  const input = readJsonObject(value, "post");
  assertExactJsonKeys(input, COMMONS_POST_KEYS, "post");

  const pills = readJsonStringArray(input, "pills", "post");
  if (pills.length > MAX_COMMONS_POST_PILLS) {
    throw new Error(`post.pills must contain at most ${MAX_COMMONS_POST_PILLS} items.`);
  }

  const post: CommonsPost = {
    title: readJsonString(input, "title", "post").trim().toUpperCase(),
    hostOrg: readJsonString(input, "hostOrg", "post").trim(),
    badge: readJsonString(input, "badge", "post").trim().toUpperCase(),
    pills: pills.map((pill) => pill.trim().toUpperCase()).filter(Boolean),
    venue: readJsonString(input, "venue", "post").trim(),
    dateLine: readJsonString(input, "dateLine", "post").trim().toUpperCase(),
    timeLine: readJsonString(input, "timeLine", "post").trim().toUpperCase(),
    caption: readJsonString(input, "caption", "post").trim(),
  };

  for (const field of ["title", "hostOrg", "badge", "venue", "dateLine", "timeLine", "caption"] as const) {
    if (post[field].length > COMMONS_POST_FIELD_LIMITS[field]) {
      throw new Error(`post.${field} is too long.`);
    }
  }
  if (post.pills.some((pill) => pill.length > COMMONS_POST_FIELD_LIMITS.pill)) {
    throw new Error("post.pills contains an item that is too long.");
  }
  if (!post.title || !post.hostOrg || !post.badge) {
    throw new Error("Post title, host organization, and badge are required.");
  }

  return post;
}
