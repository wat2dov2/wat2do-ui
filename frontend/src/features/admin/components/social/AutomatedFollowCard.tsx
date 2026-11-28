import { useTranslation } from "react-i18next";
import { foundViaLabels, VERDICT_BADGES } from "@/features/admin/lib/followCandidates";
import { FollowPostTile } from "@/features/admin/components/social/FollowPostTile";
import type { ApiAutomatedFollowResponse } from "@/shared/generated";
import { FormGrid, Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { formatRelativeTimeCompact } from "@/shared/utils/relativeTime";

interface AutomatedFollowCardProps {
  follow: ApiAutomatedFollowResponse;
  schoolName: string;
}

/** An account a school account followed on its own: the scorer's rating and reason, and its newest posts. */
export function AutomatedFollowCard({ follow, schoolName }: AutomatedFollowCardProps) {
  const { t, i18n } = useTranslation();
  const details = [
    follow.name,
    schoolName,
    follow.followers_count === null || follow.followers_count === undefined
      ? null
      : t("admin.followCandidates.followers", { value: follow.followers_count.toLocaleString(i18n.language) }),
    t("admin.automatedFollows.followedAt", { time: formatRelativeTimeCompact(follow.followed_at, t) }),
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <a href={`https://www.instagram.com/${follow.handle}/`} target="_blank" rel="noopener noreferrer">
            @{follow.handle}
          </a>
        </CardTitle>
        <CardDescription>{details.join(" · ")}</CardDescription>
        <CardAction>
          {follow.score === null || follow.score === undefined ? (
            <Badge variant="muted">{t("admin.followCandidates.unscored")}</Badge>
          ) : (
            <Badge
              variant={VERDICT_BADGES[follow.verdict ?? "review"]}
              aria-label={t("admin.automatedFollows.scoreLabel", { value: follow.score })}
            >
              {t("admin.automatedFollows.score", { value: follow.score })}
            </Badge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent>
        <Stack gap={3}>
          {follow.status === "followed" ? null : (
            <Badge variant="warning">{t(`admin.automatedFollows.statuses.${follow.status}`)}</Badge>
          )}
          {follow.reason ? <p className="text-sm">{follow.reason}</p> : null}
          {follow.found_via.length ? (
            <p className="text-xs text-muted-foreground">
              {t("admin.followCandidates.foundVia", { accounts: foundViaLabels(follow).join(", ") })}
            </p>
          ) : null}
          {follow.recent_posts.length ? (
            <FormGrid columns={3} collapse={false} className="gap-3">
              {follow.recent_posts.map((post) => <FollowPostTile key={post.url} post={post} />)}
            </FormGrid>
          ) : (
            <p className="text-sm text-muted-foreground">{t("admin.automatedFollows.noPosts")}</p>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
