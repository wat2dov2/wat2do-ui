import { Trans, useTranslation } from "react-i18next";
import { Stack } from "@/shared/layout/stack";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import type { ApiLatestAddedItem } from "@/shared/generated";

/**
 * Stands in for the count while it loads. Three digits is the common size of a
 * campus feed or directory, so the label beside it usually stays put.
 */
const PLACEHOLDER_COUNT = 100;

interface PageCountHeadingProps {
  count: number | null;
  label: string;
  level?: 1 | 2;
  /** Reuse the feed's existing live clock for its arrival-age label. */
  currentTimeMs?: number | null;
  latest?: { item: ApiLatestAddedItem; onSelect: () => void } | null;
}

export function PageCountHeading({ count, label, latest, currentTimeMs, level = 1 }: PageCountHeadingProps) {
  const { t, i18n } = useTranslation();
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <Stack gap={1} className="sm:gap-2">
    <Heading data-skeleton-key="count-heading" aria-busy={count === null} aria-label={count === null ? label : `${count.toLocaleString(i18n.language)} ${label}`} className="inline-flex items-baseline gap-2 text-left text-2xl font-bold text-foreground sm:text-3xl">
      {/* Tabular digits keep the label still as the count changes. The placeholder is an invisible
          count, so it takes the real count's box; the bar covers the digits' cap height. */}
      {/* Plain text: an animated counter (number-flow) registered CSS properties on the
          document as it loaded, a style recalculation on every page with a count. */}
      {count === null ? (
        <span aria-hidden="true" className="relative inline-flex shrink-0 items-center">
          <span className="invisible tabular-nums">{PLACEHOLDER_COUNT.toLocaleString(i18n.language)}</span>
          <Skeleton className="absolute inset-x-0 h-[1cap]" />
        </span>
      ) : <span className="tabular-nums">{count.toLocaleString(i18n.language)}</span>}
      <span data-skeleton-key="count-label">{label}</span>
    </Heading>
    {latest !== undefined && (count === null || latest) ? (
      <Stack direction="horizontal" align="center" gap={2} data-slot="latest-added-item" data-skeleton-key="latest-added">
        {latest ? <>
          <Badge variant="new" size="sm" className="shrink-0">{t("events.new")}</Badge>
          {/* The club's picture sits closer to its own title than the badge does. min-w-0 lets the title shrink. */}
          <Stack direction="horizontal" align="center" gap={1} className="min-w-0">
            {latest.item.club_logo_url ? (
              <AvatarStack size="sm" avatars={[{ src: latest.item.club_logo_url, name: latest.item.club_name ?? latest.item.title }]} />
            ) : null}
            <Button type="button" variant="link" size="inline" onClick={latest.onSelect} className="min-w-0 shrink text-left leading-tight sm:leading-normal">
              {/* One line: a long title ellipsizes so the arrival age always stays in full. Flex drops the
                  translation's spaces between parts, so the gap stands in for them. */}
              <span className="flex min-w-0 items-baseline gap-[0.3em] whitespace-nowrap">
                <Trans i18nKey="common.latestAddedItem" values={{ title: latest.item.title, time: formatRelativeTime(latest.item.added_at, t, { alwaysAgo: true, locale: i18n.language, now: currentTimeMs ?? undefined }) }} components={{ addedPrefix: <span className="shrink-0 empty:hidden" />, eventTitle: <span className="min-w-0 truncate" />, addedTime: <span className="shrink-0" /> }} />
              </span>
            </Button>
          </Stack>
        </> : (
          <>
            <Skeleton className="flex shrink-0 rounded-full" aria-hidden="true">
              <Badge variant="new" size="sm" className="invisible">{t("events.new")}</Badge>
            </Skeleton>
            <Stack direction="horizontal" align="center" gap={1} className="min-w-0" aria-hidden="true">
              <Skeleton className="size-5 shrink-0 rounded-full" />
              <Button asChild variant="link" size="inline" className="w-64 min-w-0 max-w-full shrink leading-tight sm:leading-normal">
                <span><SkeletonLine /></span>
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    ) : null}
    </Stack>
  );
}
