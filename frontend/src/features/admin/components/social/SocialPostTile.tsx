import { useTranslation } from "react-i18next";
import { Heart, MessageCircle, Music } from "lucide-react";
import type { ApiInstagramAccountPostResponse } from "@/shared/generated";
import { Stack } from "@/shared/layout";
import { LazyImage } from "@/shared/ui/lazy-image";
import { formatRelativeTimeCompact } from "@/shared/utils/relativeTime";

interface SocialPostTileProps {
  post: ApiInstagramAccountPostResponse;
  /** Shown in mixed feeds, where the post's account is not obvious from its row. */
  username?: string;
}

/** One post: its picture, likes, comments and the song the emulator added; opens the live post. */
export function SocialPostTile({ post, username }: SocialPostTileProps) {
  const { t, i18n } = useTranslation();
  const count = (value: number | null | undefined) => (typeof value === "number" ? value.toLocaleString(i18n.language) : "-");

  return (
    <a
      href={post.permalink}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("admin.socialAccounts.openPost")}
      className="min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Stack gap={1}>
        <LazyImage
          src={post.image_url}
          alt={post.caption?.slice(0, 120) ?? ""}
          sizes="(min-width: 1024px) 220px, 45vw"
          className="aspect-square w-full rounded-lg border border-border"
        />
        {username ? <span className="truncate text-xs font-semibold">@{username}</span> : null}
        <Stack direction="horizontal" gap={2} align="center" wrap>
          <span className="inline-flex items-center gap-1 text-sm font-semibold">
            <Heart className="size-3.5" aria-hidden />
            <span className="sr-only">{t("admin.socialAccounts.likes")}</span>
            {count(post.like_count)}
          </span>
          <span className="inline-flex items-center gap-1 text-sm font-semibold">
            <MessageCircle className="size-3.5" aria-hidden />
            <span className="sr-only">{t("admin.socialAccounts.comments")}</span>
            {count(post.comments_count)}
          </span>
          <time dateTime={post.posted_at} className="ms-auto text-xs text-muted-foreground">
            {formatRelativeTimeCompact(post.posted_at, t)}
          </time>
        </Stack>
        {post.music_track || post.music_status ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <Music className="size-3 shrink-0" aria-hidden />
            <span className="truncate">
              {post.music_track ?? t(`admin.socialAccounts.music.${post.music_status}`)}
            </span>
          </span>
        ) : null}
      </Stack>
    </a>
  );
}
