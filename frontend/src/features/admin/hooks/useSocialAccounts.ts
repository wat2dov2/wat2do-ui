import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getInstagramAccountStats } from "@/features/admin/api/admin.api";
import {
  average,
  dailyChange,
  needsAttention,
  postingTrends,
  totalFollowerTrend,
  type SocialPost,
  type SocialSong,
} from "@/features/admin/lib/socialAccounts";
import { queryKeys } from "@/shared/lib/queryKeys";

/** Every account's daily stats, plus the totals, trends, mixed post feed and song results built from them. */
export function useSocialAccounts() {
  const query = useQuery({
    queryKey: queryKeys.instagramPublishing.accounts(),
    queryFn: getInstagramAccountStats,
  });

  const view = useMemo(() => {
    const accounts = query.data ?? [];
    const posts = accounts.flatMap(account =>
      account.posts.map(post => ({ ...post, account_key: account.account_key, username: account.username })),
    );
    // Measured from when the stats arrived, so a render never reads the clock.
    const now = query.dataUpdatedAt;
    const songs = new Map<string, SocialPost[]>();
    for (const post of posts) {
      if (post.music_track) songs.set(post.music_track, [...(songs.get(post.music_track) ?? []), post]);
    }
    const followers = totalFollowerTrend(accounts);
    const capturedAt = accounts.map(account => account.captured_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

    return {
      accounts,
      posts,
      capturedAt,
      summary: {
        needingAttention: accounts.filter(account => needsAttention(account, now)).length,
        followers: accounts.reduce((sum, account) => sum + (account.followers_count ?? 0), 0),
        averageLikes: average(posts.map(post => post.like_count)),
      },
      trends: { followers, followerGains: dailyChange(followers), ...postingTrends(posts, now) },
      music: {
        added: posts.filter(post => post.music_status === "added").length,
        failed: posts.filter(post => post.music_status === "failed").length,
        pending: posts.filter(post => post.music_status === "pending").length,
      },
      songs: [...songs.entries()]
        .map(([track, songPosts]): SocialSong => ({
          track,
          posts: songPosts,
          averageLikes: average(songPosts.map(post => post.like_count)),
          averageComments: average(songPosts.map(post => post.comments_count)),
        }))
        .sort((a, b) => (b.averageLikes ?? -1) - (a.averageLikes ?? -1)),
    };
  }, [query.data, query.dataUpdatedAt]);

  return { query, readAt: query.dataUpdatedAt, ...view };
}
