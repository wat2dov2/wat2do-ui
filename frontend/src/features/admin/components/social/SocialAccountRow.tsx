import { useTranslation } from "react-i18next";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { CARD_POST_COUNT, engagement, followerChange, followerTrend, needsAttention, postingTrends, type SocialAccount } from "@/features/admin/lib/socialAccounts";
import { SocialPostTile } from "@/features/admin/components/social/SocialPostTile";
import { SocialTrendChart } from "@/features/admin/components/social/SocialTrendChart";
import { FormGrid, Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { LazyImage } from "@/shared/ui/lazy-image";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { formatRelativeTimeCompact } from "@/shared/utils/relativeTime";

/** One account card: who it is, charts of how it is growing, and its newest posts side by side. */
export function SocialAccountRow({ account, readAt }: { account: SocialAccount; readAt: number }) {
  const { t, i18n } = useTranslation();
  const { getSchoolName } = useSchoolDirectory();
  const number = (value: number) => value.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  const change = followerChange(account);
  const { likes, rate } = engagement(account);
  const latest = account.posts[0];

  const { posts: activity, likes: likesTrend } = postingTrends(account.posts, readAt);
  const charts = [
    {
      title: t("admin.socialAccounts.followersChart"),
      value: account.followers_count === null ? "-" : number(account.followers_count),
      // captured_on is a calendar day; read it at noon so no time zone moves it.
      detail: change === null ? null : t("admin.socialAccounts.change", {
        value: `${change.value > 0 ? "+" : ""}${number(change.value)}`,
        date: new Date(`${change.since}T12:00:00`).toLocaleDateString(i18n.language, { month: "short", day: "numeric" }),
      }),
      trend: followerTrend(account),
    },
    {
      title: t("admin.socialAccounts.summary.averageLikes"),
      value: likes === null ? "-" : number(likes),
      detail: rate === null ? null : t("admin.socialAccounts.rate", { value: (rate * 100).toLocaleString(i18n.language, { maximumFractionDigits: 1 }) }),
      trend: likesTrend,
    },
    {
      title: t("admin.socialAccounts.summary.postsPerDay"),
      value: number(activity.at(-1)?.value ?? 0),
      detail: latest ? t("admin.socialAccounts.lastPost", { time: formatRelativeTimeCompact(latest.posted_at, t) }) : null,
      trend: activity,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Stack direction="horizontal" gap={3} align="center">
            <LazyImage src={account.profile_picture_url} alt="" width={40} height={40} className="size-10 shrink-0 rounded-full border border-border" />
            <Stack gap={1}>
              <span>@{account.username}</span>
              <CardDescription>{getSchoolName(account.account_key)}</CardDescription>
            </Stack>
          </Stack>
        </CardTitle>
        <CardAction>
          <Stack direction="horizontal" gap={2} align="center">
            {needsAttention(account, readAt) ? (
              <Badge variant={account.requires_reauthorization ? "destructive" : "warning"}>
                <AlertTriangle aria-hidden />
                {account.requires_reauthorization
                  ? t("admin.socialAccounts.reconnect")
                  : t("admin.socialAccounts.tokenExpires", { date: new Date(account.token_expires_at).toLocaleDateString(i18n.language) })}
              </Badge>
            ) : null}
            <Button asChild variant="outline" size="icon-sm" aria-label={t("admin.socialAccounts.openProfile")}>
              <a href={`https://www.instagram.com/${account.username}/`} target="_blank" rel="noopener noreferrer"><ExternalLink /></a>
            </Button>
          </Stack>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Stack gap={3}>
          {charts.map(chart => <SocialTrendChart key={chart.title} {...chart} />)}
        {account.posts.length ? (
          <FormGrid columns={3} collapse={false} className="gap-3">
            {account.posts.slice(0, CARD_POST_COUNT).map(post => <SocialPostTile key={post.media_id} post={post} />)}
          </FormGrid>
        ) : (
          <p className="text-sm text-muted-foreground">
            {account.captured_at ? t("admin.socialAccounts.noPosts") : t("admin.socialAccounts.notRead")}
          </p>
        )}
        </Stack>
      </CardContent>
    </Card>
  );
}
