import { useTranslation } from "react-i18next";
import { Check, ExternalLink, X } from "lucide-react";
import type { FollowDecision } from "@/features/admin/lib/followCandidates";
import type { ApiFollowCandidateResponse } from "@/shared/generated";
import { Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/shared/ui/card";
import { formatRelativeTimeCompact } from "@/shared/utils/relativeTime";

const VERDICT_BADGES = { approve: "success", review: "warning", reject: "muted" } as const;

interface FollowCandidateCardProps {
  candidate: ApiFollowCandidateResponse;
  schoolName: string;
  decision: FollowDecision | null;
  /** Only accounts still waiting for review can be decided. */
  onDecide?: (decision: FollowDecision) => void;
}

/** One account a school account might follow: its score, context and a link to the live profile. */
export function FollowCandidateCard({ candidate, schoolName, decision, onDecide }: FollowCandidateCardProps) {
  const { t, i18n } = useTranslation();
  const profileUrl = `https://www.instagram.com/${candidate.handle}/`;
  const details = [
    schoolName,
    candidate.followers_count === null || candidate.followers_count === undefined
      ? null
      : t("admin.followCandidates.followers", { value: candidate.followers_count.toLocaleString(i18n.language) }),
    candidate.last_posted_at
      ? t("admin.socialAccounts.lastPost", { time: formatRelativeTimeCompact(candidate.last_posted_at, t) })
      : t(`admin.followCandidates.read.${candidate.read_status ?? "unread"}`),
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <a href={profileUrl} target="_blank" rel="noopener noreferrer" aria-label={t("admin.socialAccounts.openProfile")}>
            @{candidate.handle}
          </a>
        </CardTitle>
        <CardDescription>{[candidate.name, ...details].filter(Boolean).join(" · ")}</CardDescription>
        <CardAction>
          {candidate.score === null || candidate.score === undefined ? (
            <Badge variant="muted">{t("admin.followCandidates.unscored")}</Badge>
          ) : (
            <Badge variant={VERDICT_BADGES[candidate.verdict ?? "review"]}>{candidate.score}</Badge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent>
        <Stack gap={3}>
          {candidate.reason ? <p className="text-sm">{candidate.reason}</p> : null}
          {candidate.found_via.length ? (
            <p className="text-xs text-muted-foreground">
              {t("admin.followCandidates.foundVia", { accounts: candidate.found_via.map((handle) => `@${handle}`).join(", ") })}
            </p>
          ) : null}
          {candidate.follow_error ? <Badge variant="warning">{candidate.follow_error}</Badge> : null}
          <Button asChild variant="outline" size="sm">
            <a href={profileUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              {t("admin.socialAccounts.openProfile")}
            </a>
          </Button>
        </Stack>
      </CardContent>
      {onDecide ? (
        <CardFooter>
          <Stack direction="horizontal" gap={2}>
            <Button type="button" variant="outline" size="sm" selected={decision === "approved"} onClick={() => onDecide("approved")}>
              <Check aria-hidden />
              {t("admin.followCandidates.approve")}
            </Button>
            <Button type="button" variant="outline" size="sm" selected={decision === "rejected"} onClick={() => onDecide("rejected")}>
              <X aria-hidden />
              {t("admin.followCandidates.reject")}
            </Button>
          </Stack>
        </CardFooter>
      ) : null}
    </Card>
  );
}
