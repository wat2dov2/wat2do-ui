import { useTranslation } from "react-i18next";
import type { ApiFollowPostResponse } from "@/shared/generated";
import { Stack } from "@/shared/layout";
import { LazyImage } from "@/shared/ui/lazy-image";
import { formatRelativeTimeCompact } from "@/shared/utils/relativeTime";

/** One of a followed account's newest posts: its picture (its caption when the picture is gone) and when it went up; opens the live post. */
export function FollowPostTile({ post }: { post: ApiFollowPostResponse }) {
  const { t } = useTranslation();
  const caption = post.caption || t("admin.automatedFollows.noCaption");

  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("admin.socialAccounts.openPost")}
      className="min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Stack gap={1}>
        <LazyImage
          src={post.image}
          alt={caption.slice(0, 120)}
          className="aspect-square w-full rounded-lg border border-border"
          fallback={<span className="line-clamp-6 p-2 text-start text-xs text-foreground">{caption}</span>}
        />
        {post.posted_at ? (
          <time dateTime={post.posted_at} className="text-xs text-muted-foreground">
            {formatRelativeTimeCompact(post.posted_at, t)}
          </time>
        ) : null}
      </Stack>
    </a>
  );
}
