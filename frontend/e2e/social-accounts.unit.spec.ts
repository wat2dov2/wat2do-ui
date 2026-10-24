import { expect, test } from "@playwright/test";
import {
  engagement,
  followerChange,
  needsAttention,
  sortAccounts,
  sortPosts,
  type SocialAccount,
  type SocialPost,
} from "../src/features/admin/lib/socialAccounts";

const NOW = Date.parse("2026-10-24T12:00:00Z");

function account(key: string, overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    account_key: key,
    username: `wat2do.${key}`,
    followers_count: 1000,
    requires_reauthorization: false,
    token_expires_at: "2026-12-11T00:00:00Z",
    followers_history: [],
    posts: [],
    ...overrides,
  };
}

function post(id: string, likes: number | null, comments: number | null, postedAt: string): SocialPost {
  return { media_id: id, media_type: "IMAGE", permalink: `https://www.instagram.com/p/${id}/`, posted_at: postedAt, like_count: likes, comments_count: comments, account_key: "a", username: "wat2do.a" };
}

test("follower change needs two days and counts from the oldest one", () => {
  expect(followerChange(account("a", { followers_history: [{ captured_on: "2026-10-24", followers_count: 1000 }] }))).toBeNull();
  expect(followerChange(account("a", {
    followers_history: [
      { captured_on: "2026-10-20", followers_count: 950 },
      { captured_on: "2026-10-24", followers_count: 1000 },
    ],
  }))).toEqual({ value: 50, since: "2026-10-20" });
});

test("engagement averages known counts and compares them to followers", () => {
  const stats = engagement(account("a", { posts: [post("1", 40, 2, "2026-10-23T00:00:00Z"), post("2", null, 4, "2026-10-22T00:00:00Z")] }));
  expect(stats).toEqual({ likes: 40, comments: 3, rate: 0.043 });
  expect(engagement(account("a")).rate).toBeNull();
});

test("tokens near expiry or needing reauthorization need attention", () => {
  expect(needsAttention(account("a"), NOW)).toBe(false);
  expect(needsAttention(account("a", { token_expires_at: "2026-10-28T00:00:00Z" }), NOW)).toBe(true);
  expect(needsAttention(account("a", { requires_reauthorization: true }), NOW)).toBe(true);
});

test("sorts put the strongest account and post first, unknowns last", () => {
  const unread = account("unread", { followers_count: null });
  const big = account("big", { followers_count: 5000 });
  expect(sortAccounts([unread, account("small"), big], "followers").map(item => item.account_key)).toEqual(["big", "small", "unread"]);
  const posts = [post("old", 90, 0, "2026-10-01T00:00:00Z"), post("new", 10, 5, "2026-10-23T00:00:00Z")];
  expect(sortPosts(posts, "newest").map(item => item.media_id)).toEqual(["new", "old"]);
  expect(sortPosts(posts, "likes").map(item => item.media_id)).toEqual(["old", "new"]);
});
