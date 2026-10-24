import { useTranslation } from "react-i18next";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { engagement, followerChange, needsAttention, type SocialAccount } from "@/features/admin/lib/socialAccounts";
import { SocialPostStrip } from "@/features/admin/components/social/SocialPostStrip";
import { Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { LazyImage } from "@/shared/ui/lazy-image";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { formatRelativeTimeCompact } from "@/shared/utils/relativeTime";

/** One account on one row: who it is, how it is growing, and every recent post side by side. */
export function SocialAccountRow({ account, readAt }: { account: SocialAccount; readAt: number }) {
  const { t, i18n } = useTranslation();
  const { getSchoolName } = useSchoolDirectory();
  const number = (value: number) => value.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  const change = followerChange(account);
  const { likes, comments, rate } = engagement(account);
  const latest = account.posts[0];

  const facts = [
    account.followers_count === null ? null : t("admin.socialAccounts.followers", { value: number(account.followers_count) }),
    // captured_on is a calendar day; read it at noon so no time zone moves it.
    change === null ? null : t("admin.socialAccounts.change", {
      value: `${change.value > 0 ? "+" : ""}${number(change.value)}`,
      date: new Date(`${change.since}T12:00:00`).toLocaleDateString(i18n.language, { month: "short", day: "numeric" }),
    }),
    account.media_count === null ? null : t("admin.socialAccounts.postCount", { value: number(account.media_count) }),
    likes === null ? null : t("admin.socialAccounts.averages", { likes: number(likes), comments: number(comments ?? 0) }),
    rate === null ? null : t("admin.socialAccounts.rate", { value: (rate * 100).toLocaleString(i18n.language, { maximumFractionDigits: 1 }) }),
    latest ? t("admin.socialAccounts.lastPost", { time: formatRelativeTimeCompact(latest.posted_at, t) }) : null,
  ].filter(Boolean);

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
        <CardDescription>{facts.join(" · ")}</CardDescription>
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
        {account.posts.length ? (
          <SocialPostStrip posts={account.posts} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {account.captured_at ? t("admin.socialAccounts.noPosts") : t("admin.socialAccounts.notRead")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
