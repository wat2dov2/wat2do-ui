import { expect, test } from "@playwright/test";
import {
  decisionFor,
  decisionsToSubmit,
  groupByDay,
  toggleDecision,
  type StagedDecisions,
} from "../src/features/admin/lib/followCandidates";
import type { ApiFollowCandidateResponse } from "../src/shared/generated";

function candidate(id: string, overrides: Partial<ApiFollowCandidateResponse> = {}): ApiFollowCandidateResponse {
  return {
    id,
    school: "utsg",
    handle: id,
    source: "crawl",
    found_via: [],
    status: "pending",
    status_changed_at: "2026-11-24T20:00:00Z",
    recent_posts: [],
    ...overrides,
  };
}

const NONE: StagedDecisions = new Map();
const strong = candidate("utmaclub", { score: 82, verdict: "approve" });
const unsure = candidate("rocsaut", { score: 55, verdict: "review" });

test("a strong approved score starts approved and an unsure one starts undecided", () => {
  expect(decisionFor(strong, NONE)).toBe("approved");
  expect(decisionFor(unsure, NONE)).toBeNull();
});

test("pressing the decision shown clears it, and pressing the other replaces it", () => {
  const cleared = toggleDecision(NONE, strong, "approved");
  expect(decisionFor(strong, cleared)).toBeNull();
  expect(decisionFor(strong, toggleDecision(NONE, strong, "rejected"))).toBe("rejected");
});

test("submit sends the page's suggestions and every decision made elsewhere", () => {
  const elsewhere = candidate("other.page");
  let staged = toggleDecision(NONE, elsewhere, "rejected");
  staged = toggleDecision(staged, unsure, "approved");

  expect(decisionsToSubmit([strong, unsure], staged)).toEqual([
    { id: "utmaclub", status: "approved" },
    { id: "rocsaut", status: "approved" },
    { id: "other.page", status: "rejected" },
  ]);
});

test("a cleared suggestion and settled accounts are never sent", () => {
  const followed = candidate("done", { status: "followed", score: 90, verdict: "approve" });

  expect(decisionsToSubmit([strong, followed], toggleDecision(NONE, strong, "approved"))).toEqual([]);
});

test("followed accounts group under the day they were followed, in the admin's time zone, newest first", () => {
  const late = candidate("late", { status: "followed", status_changed_at: "2026-11-25T02:30:00Z" });
  const evening = candidate("evening", { status: "followed", status_changed_at: "2026-11-24T23:00:00Z" });
  const earlier = candidate("earlier", { status: "followed", status_changed_at: "2026-11-22T15:00:00Z" });
  const days = groupByDay([late, evening, earlier], "America/Toronto");
  // 02:30 UTC on the 25th is still the evening of the 24th in Toronto.
  expect(days.map(({ day, candidates }) => [day, candidates.map(({ id }) => id)])).toEqual([
    ["2026-11-24", ["late", "evening"]],
    ["2026-11-22", ["earlier"]],
  ]);
  expect(groupByDay([late], "UTC")[0].day).toBe("2026-11-25");
});

