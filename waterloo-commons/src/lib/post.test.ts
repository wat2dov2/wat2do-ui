import { describe, expect, it } from "vitest";
import {
  COMMONS_POST_FIELD_LIMITS,
  MAX_COMMONS_POST_PILLS,
  normalisePost,
  parseCommonsPost,
} from "@/lib/post";

describe("normalisePost", () => {
  it("normalizes copy and keeps five tags", () => {
    const post = normalisePost({
      title: "  Fall kickoff  ",
      hostOrg: "  Socratica ",
      badge: " vibe ",
      pills: [" social ", " snacks ", " games ", " rooftop ", " music "],
      venue: "  Builders Club ",
      dateLine: " thu, sept 18 ",
      timeLine: " 6:00 pm ",
      caption: "  Join us. ",
    });

    expect(post.title).toBe("FALL KICKOFF");
    expect(post.badge).toBe("VIBE");
    expect(post.pills).toEqual(["SOCIAL", "SNACKS", "GAMES", "ROOFTOP", "MUSIC"]);
    expect(post.caption).toBe("Join us.");
  });

  it("rejects unknown fields, excessive tags, and oversized fields", () => {
    const validPost = {
      title: "Fall kickoff",
      hostOrg: "Socratica",
      badge: "Vibe",
      pills: ["Social"],
      venue: "Builders Club",
      dateLine: "Thu, Sept 18",
      timeLine: "6:00 PM",
      caption: "Join us.",
    };

    expect(() => normalisePost({ ...validPost, extra: true })).toThrow(
      "post.extra is not allowed",
    );
    expect(() => normalisePost({
      ...validPost,
      pills: Array.from({ length: MAX_COMMONS_POST_PILLS + 1 }, () => "TAG"),
    })).toThrow("post.pills must contain at most");
    expect(() => normalisePost({
      ...validPost,
      caption: "x".repeat(COMMONS_POST_FIELD_LIMITS.caption + 1),
    })).toThrow("post.caption is too long");
  });

  it("rejects malformed database post records", () => {
    expect(() => parseCommonsPost({ title: "Missing every other field" })).toThrow(
      "submission post.hostOrg must be a string",
    );
  });
});
