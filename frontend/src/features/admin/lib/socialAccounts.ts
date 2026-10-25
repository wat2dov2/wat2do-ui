/** Pure math behind the admin social dashboard: growth, engagement, attention and sorting. */
import type { ApiInstagramAccountPostResponse, ApiInstagramAccountStatsResponse } from "@/shared/generated";

export type SocialAccount = ApiInstagramAccountStatsResponse;
/** One post with the account it belongs to, for views that mix every account. */
export type SocialPost = ApiInstagramAccountPostResponse & { account_key: string; username: string };
export interface SocialSong {
  track: string;
  posts: SocialPost[];
  averageLikes: number | null;
  averageComments: number | null;
}

export const ACCOUNT_SORTS = ["followers", "growth", "engagement", "latest"] as const;
export type AccountSort = (typeof ACCOUNT_SORTS)[number];
export const POST_SORTS = ["newest", "likes", "comments"] as const;
export type PostSort = (typeof POST_SORTS)[number];

export const DAY_MS = 86_400_000;
export const RECENT_POST_DAYS = 7;
/** Posts each account card shows; the All posts tab lists the rest. */
export const CARD_POST_COUNT = 3;
/** Tokens this close to expiring need a person before the daily refresh gives up on them. */
const TOKEN_WARNING_DAYS = 7;

export function average(values: (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => typeof value === "number");
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

/** Followers gained since the oldest stored day, or null until there are two days to compare. */
export function followerChange(account: SocialAccount): { value: number; since: string } | null {
  const history = account.followers_history;
  if (history.length < 2) return null;
  return { value: history[history.length - 1].followers_count - history[0].followers_count, since: history[0].captured_on };
}

/** Average likes and comments per post, and how that compares to the follower count. */
export function engagement(account: SocialAccount) {
  const likes = average(account.posts.map(post => post.like_count));
  const comments = average(account.posts.map(post => post.comments_count));
  const interactions = likes === null && comments === null ? null : (likes ?? 0) + (comments ?? 0);
  const rate = interactions !== null && account.followers_count ? interactions / account.followers_count : null;
  return { likes, comments, rate };
}

export function needsAttention(account: SocialAccount, now: number) {
  return account.requires_reauthorization || new Date(account.token_expires_at).getTime() - now < TOKEN_WARNING_DAYS * DAY_MS;
}

export function sortAccounts(accounts: SocialAccount[], sort: AccountSort): SocialAccount[] {
  const key: Record<AccountSort, (account: SocialAccount) => number> = {
    followers: account => account.followers_count ?? -1,
    growth: account => followerChange(account)?.value ?? Number.NEGATIVE_INFINITY,
    engagement: account => engagement(account).rate ?? -1,
    latest: account => (account.posts[0] ? new Date(account.posts[0].posted_at).getTime() : 0),
  };
  return [...accounts].sort((a, b) => key[sort](b) - key[sort](a));
}

export function sortPosts(posts: SocialPost[], sort: PostSort): SocialPost[] {
  const key: Record<PostSort, (post: SocialPost) => number> = {
    newest: post => new Date(post.posted_at).getTime(),
    likes: post => post.like_count ?? -1,
    comments: post => post.comments_count ?? -1,
  };
  return [...posts].sort((a, b) => key[sort](b) - key[sort](a));
}
