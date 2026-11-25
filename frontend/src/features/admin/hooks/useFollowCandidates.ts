import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getFollowCandidates,
  submitFollowDecisions,
  type ApiFollowCandidateStatus,
} from "@/features/admin/api/admin.api";
import {
  decisionFor,
  decisionsToSubmit,
  toggleDecision,
  type FollowCandidateWindow,
  type FollowDecision,
  type StagedDecisions,
} from "@/features/admin/lib/followCandidates";
import type { ApiFollowCandidateResponse } from "@/shared/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

const PAGE_SIZE = 24;
const NO_DECISIONS: StagedDecisions = new Map();

/** One page of follow candidates, with the admin's decisions held on the page until submit. */
export function useFollowCandidates() {
  const queryClient = useQueryClient();
  const [school, setSchoolFilter] = useState("");
  const [status, setStatusFilter] = useState<ApiFollowCandidateStatus>("pending");
  const [days, setDaysFilter] = useState<FollowCandidateWindow | null>(null);
  const [page, setPage] = useState(1);
  const [staged, setStaged] = useState<StagedDecisions>(NO_DECISIONS);

  const query = useQuery({
    queryKey: queryKeys.instagramPublishing.followCandidatePage(school, status, days, page),
    queryFn: () => getFollowCandidates({ school, status, days, page, pageSize: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });
  const candidates = query.data?.items ?? [];
  // A page still loading shows the last one; its suggestions are not this page's to send.
  const pending = decisionsToSubmit(query.isPlaceholderData ? [] : candidates, staged);

  const submit = useMutation({
    mutationFn: () => submitFollowDecisions(pending),
    onSuccess: () => {
      setStaged(NO_DECISIONS);
      return queryClient.invalidateQueries({ queryKey: queryKeys.instagramPublishing.followCandidates() });
    },
  });

  return {
    query,
    candidates,
    school,
    status,
    days,
    page,
    totalPages: query.data?.total_pages ?? 0,
    total: query.data?.total ?? 0,
    pendingCount: pending.length,
    submit,
    setPage,
    setSchool: (value: string) => {
      setSchoolFilter(value);
      setPage(1);
    },
    setStatus: (value: ApiFollowCandidateStatus) => {
      setStatusFilter(value);
      setPage(1);
    },
    setDays: (value: FollowCandidateWindow | null) => {
      setDaysFilter(value);
      setPage(1);
    },
    decisionFor: (candidate: ApiFollowCandidateResponse) => decisionFor(candidate, staged),
    decide: (candidate: ApiFollowCandidateResponse, decision: FollowDecision) =>
      setStaged((current) => toggleDecision(current, candidate, decision)),
  };
}
