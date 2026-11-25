import type { ApiFollowCandidateDecision, ApiFollowCandidateResponse } from "@/shared/generated";
import type { DayWindow } from "@/features/admin/lib/dayWindows";
import instagramFollowControl from "../../../../../backend/controlbox/instagram_follow.json" with { type: "json" };

export type FollowDecision = ApiFollowCandidateDecision["status"];
/** Decisions the admin made on the page; null clears a suggestion. Nothing is saved until submit. */
export type StagedDecisions = ReadonlyMap<string, FollowDecision | null>;

export const FOLLOW_CANDIDATE_STATUSES = ["pending", "approved", "followed", "unfollow", "rejected"] as const;

/** "Any time" (null) or the last N days, by when each account reached its status. */
export const FOLLOW_CANDIDATE_WINDOWS = [1, 3, 7, 30] as const satisfies readonly DayWindow[];
export type FollowCandidateWindow = (typeof FOLLOW_CANDIDATE_WINDOWS)[number];

export interface FollowCandidateDay {
  /** The calendar day, YYYY-MM-DD. */
  day: string;
  candidates: ApiFollowCandidateResponse[];
}

/** The candidates in their order (newest first), under the day each reached its status, in `timeZone` (the browser's by default). */
export function groupByDay(candidates: readonly ApiFollowCandidateResponse[], timeZone?: string): FollowCandidateDay[] {
  const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const days: FollowCandidateDay[] = [];
  for (const candidate of candidates) {
    const day = dayOf.format(new Date(candidate.status_changed_at));
    const last = days.at(-1);
    if (last?.day === day) last.candidates.push(candidate);
    else days.push({ day, candidates: [candidate] });
  }
  return days;
}

/** A strong score the scorer approved starts approved, as on the old review page. */
export function suggestedDecision(candidate: ApiFollowCandidateResponse): FollowDecision | null {
  return candidate.verdict === "approve" && (candidate.score ?? 0) >= instagramFollowControl.auto_approve_score
    ? "approved"
    : null;
}

export function decisionFor(candidate: ApiFollowCandidateResponse, staged: StagedDecisions): FollowDecision | null {
  return staged.has(candidate.id) ? staged.get(candidate.id) ?? null : suggestedDecision(candidate);
}

/** Pressing the decision already shown clears it; any other press replaces it. */
export function toggleDecision(
  staged: StagedDecisions,
  candidate: ApiFollowCandidateResponse,
  decision: FollowDecision,
): StagedDecisions {
  const next = new Map(staged);
  next.set(candidate.id, decisionFor(candidate, staged) === decision ? null : decision);
  return next;
}

/** What submit sends: every decision made anywhere, plus the suggestions on the page in view. */
export function decisionsToSubmit(
  visible: readonly ApiFollowCandidateResponse[],
  staged: StagedDecisions,
): ApiFollowCandidateDecision[] {
  const decisions = new Map<string, FollowDecision>();
  for (const candidate of visible) {
    const decision = candidate.status === "pending" ? decisionFor(candidate, staged) : null;
    if (decision) decisions.set(candidate.id, decision);
  }
  for (const [id, decision] of staged) {
    if (decision) decisions.set(id, decision);
    else decisions.delete(id);
  }
  return [...decisions].map(([id, status]) => ({ id, status }));
}
