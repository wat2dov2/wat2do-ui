import NumberFlow from "@number-flow/react";
import { Trans, useTranslation } from "react-i18next";
import { Stack } from "@/shared/layout/stack";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import type { ApiLatestAddedItem } from "@/shared/generated";

interface PageCountHeadingProps {
  count: number | null;
  label: string;
  level?: 1 | 2;
  latest?: { item: ApiLatestAddedItem; onSelect: () => void } | null;
}

export function PageCountHeading({ count, label, latest, level = 1 }: PageCountHeadingProps) {
  const { t, i18n } = useTranslation();
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <Stack gap={1} className="sm:gap-2">
    <Heading aria-busy={count === null} aria-label={count === null ? label : `${count.toLocaleString(i18n.language)} ${label}`} className="inline-flex items-baseline gap-2 text-left text-2xl font-bold text-foreground sm:text-3xl">
      {/* Cap height follows the visible digits; the font em includes empty vertical space. */}
      {count === null ? <Skeleton className="h-[1cap] w-[2ch] shrink-0" aria-hidden="true" /> : <NumberFlow value={count} respectMotionPreference />}
      <span>{label}</span>
    </Heading>
    {latest !== undefined && (count === null || latest) ? (
      <Stack direction="horizontal" align="center" gap={2} data-slot="latest-added-item">
        {latest ? <>
          <Badge variant="new" size="sm" className="shrink-0">{t("events.new")}</Badge>
          <Button type="button" variant="link" size="inline" onClick={latest.onSelect} className="min-w-0 shrink text-left leading-tight sm:leading-normal">
            <span>
              <Trans i18nKey="common.latestAddedItem" values={{ title: latest.item.title, time: formatRelativeTime(latest.item.added_at, t, { alwaysAgo: true }) }} components={{ addedPrefix: <span />, eventTitle: <span />, addedTime: <span /> }} />
            </span>
          </Button>
        </> : (
          <Skeleton className="flex w-64 max-w-full" aria-hidden="true">
            <Button asChild variant="link" size="inline" className="invisible leading-tight sm:leading-normal">
              <span>{t("events.new")}</span>
            </Button>
          </Skeleton>
        )}
      </Stack>
    ) : null}
    </Stack>
  );
}
