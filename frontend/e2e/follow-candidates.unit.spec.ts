import { expect, test } from "@playwright/test";
import {
  decisionFor,
  decisionsToSubmit,
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
