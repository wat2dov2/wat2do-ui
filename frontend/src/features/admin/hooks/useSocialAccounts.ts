import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getInstagramAccountStats } from "@/features/admin/api/admin.api";
import { average, DAY_MS, followerChange, needsAttention, RECENT_POST_DAYS, type SocialPost, type SocialSong } from "@/features/admin/lib/socialAccounts";
import { queryKeys } from "@/shared/lib/queryKeys";

/** Every account's daily stats, plus the totals, mixed post feed and song results built from them. */
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
    const changes = accounts.map(account => followerChange(account)?.value).filter((change): change is number => change !== undefined);
    const capturedAt = accounts.map(account => account.captured_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

    return {
      accounts,
      posts,
      capturedAt,
      summary: {
        accounts: accounts.length,
        needingAttention: accounts.filter(account => needsAttention(account, now)).length,
        followers: accounts.reduce((sum, account) => sum + (account.followers_count ?? 0), 0),
        followerChange: changes.length ? changes.reduce((sum, change) => sum + change, 0) : null,
        recentPosts: posts.filter(post => now - new Date(post.posted_at).getTime() < RECENT_POST_DAYS * DAY_MS).length,
        averageLikes: average(posts.map(post => post.like_count)),
      },
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
