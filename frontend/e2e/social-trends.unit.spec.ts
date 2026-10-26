import { expect, test } from "@playwright/test";
import { dailyChange, postingTrends, totalFollowerTrend, type SocialAccount } from "../src/features/admin/lib/socialAccounts";

function account(history: [string, number][]): SocialAccount {
  return {
    account_key: "uwaterloo",
    username: "wat2do.uwaterloo",
    requires_reauthorization: false,
    token_expires_at: "2026-12-01T00:00:00Z",
    followers_history: history.map(([captured_on, followers_count]) => ({ captured_on, followers_count })),
    posts: [],
  };
}

test("total followers carry an account's last known count over a missed day", () => {
  const trend = totalFollowerTrend([
    account([["2026-10-01", 100], ["2026-10-02", 110], ["2026-10-03", 120]]),
    account([["2026-10-01", 50], ["2026-10-03", 60]]),
  ]);
  expect(trend).toEqual([
    { day: "2026-10-01", value: 150 },
    { day: "2026-10-02", value: 160 },
    { day: "2026-10-03", value: 180 },
  ]);
  expect(dailyChange(trend)).toEqual([
    { day: "2026-10-02", value: 10 },
    { day: "2026-10-03", value: 20 },
  ]);
});

test("posting trends count every day of the month and average likes only on days with posts", () => {
  const now = new Date(2026, 9, 25, 15).getTime();
  const post = (day: number, likes: number | null, month = 9) => ({
    media_id: `${month}-${day}-${likes}`,
    media_type: "CAROUSEL_ALBUM",
    permalink: "https://www.instagram.com/p/x/",
    posted_at: new Date(2026, month, day, 12).toISOString(),
    like_count: likes,
  });
  const { posts, likes } = postingTrends([post(25, 10), post(25, 30), post(20, null), post(1, 99, 8)], now);
  expect(posts).toHaveLength(30);
  expect(posts.at(-1)).toEqual({ day: "2026-10-25", value: 2 });
  expect(posts.find(point => point.day === "2026-10-20")?.value).toBe(1);
  expect(posts.reduce((sum, point) => sum + point.value, 0)).toBe(3);
  expect(likes).toEqual([{ day: "2026-10-25", value: 20 }]);
});
