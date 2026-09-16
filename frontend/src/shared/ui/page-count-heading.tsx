import NumberFlow from "@number-flow/react";
import { Trans, useTranslation } from "react-i18next";
import { Stack } from "@/shared/layout/stack";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import type { ApiLatestAddedItem } from "@/shared/generated";

interface PageCountHeadingProps {
  count: number;
  label: string;
  level?: 1 | 2;
  latest?: { item: ApiLatestAddedItem; onSelect: () => void } | null;
}

export function PageCountHeading({ count, label, latest, level = 1 }: PageCountHeadingProps) {
  const { t, i18n } = useTranslation();
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <Stack gap={1} className="sm:gap-2">
    <Heading aria-label={`${count.toLocaleString(i18n.language)} ${label}`} className="inline-flex items-baseline gap-2 text-left text-2xl font-bold text-foreground sm:text-3xl">
      <NumberFlow value={count} respectMotionPreference={false} />
      <span>{label}</span>
    </Heading>
    {latest ? (
      <Stack direction="horizontal" align="baseline" gap={2}>
        <Badge variant="new" size="sm" className="shrink-0">{t("events.new")}</Badge>
        <Button type="button" variant="link" size="inline" onClick={latest.onSelect} className="min-w-0 shrink text-left leading-tight sm:leading-normal">
          <span>
            <Trans i18nKey="common.latestAddedItem" values={{ title: latest.item.title, time: formatRelativeTime(latest.item.added_at, t, { alwaysAgo: true }) }} components={{ addedPrefix: <span />, eventTitle: <span />, addedTime: <span /> }} />
          </span>
        </Button>
      </Stack>
    ) : null}
    </Stack>
  );
}
