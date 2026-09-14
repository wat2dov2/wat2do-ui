import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPositionSubmissions, getAdminPosterPayouts } from "@/features/admin/api/admin.api";
import { queryKeys } from "@/shared/lib/queryKeys";
import { useAdminStore } from "@/features/admin/store/admin.store";
import { REPORT_PENDING, SUBMISSION_PENDING } from "@/shared/constants/statuses";

const payoutFilters = { page: 1, pageSize: 1, payoutStatus: "pending" } as const;

export function useAdminPanel() {
  const submissions = useAdminStore(s => s.submissions);
  const reports = useAdminStore(s => s.reports);
  const claims = useAdminStore(s => s.claims);
  const clubSubmissions = useAdminStore(s => s.clubSubmissions);
  const loadedAt = useAdminStore(s => s.loadedAt);
  const submissionsSchool = useAdminStore(s => s.submissionsSchool);
  const claimsSchool = useAdminStore(s => s.claimsSchool);
  const clubSubmissionsSchool = useAdminStore(s => s.clubSubmissionsSchool);
  const fetchSubmissions = useAdminStore(s => s.fetchSubmissions);
  const fetchReports = useAdminStore(s => s.fetchReports);
  const fetchClaims = useAdminStore(s => s.fetchClaims);
  const fetchClubSubmissions = useAdminStore(s => s.fetchClubSubmissions);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const positions = useQuery({
    queryKey: queryKeys.positionSubmissions.list(1, SUBMISSION_PENDING),
    queryFn: () => getPositionSubmissions(1, SUBMISSION_PENDING),
  });
  const payouts = useQuery({
    queryKey: queryKeys.posterPayouts.list(payoutFilters),
    queryFn: () => getAdminPosterPayouts(payoutFilters),
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchSubmissions(undefined, attempt > 0),
      fetchReports(attempt > 0),
      fetchClaims(undefined, attempt > 0),
      fetchClubSubmissions(undefined, attempt > 0),
    ]).then(() => {
      if (!cancelled) setLoadFailed(false);
    }).catch(() => {
      if (!cancelled) setLoadFailed(true);
    });
    return () => { cancelled = true; };
  }, [fetchSubmissions, fetchReports, fetchClaims, fetchClubSubmissions, attempt]);

  return {
    counts: {
      eventSubmissions: loadedAt.submissions !== undefined && submissionsSchool === undefined
        ? submissions.filter(item => item.status === SUBMISSION_PENDING).length : null,
      eventReports: loadedAt.reports !== undefined
        ? reports.filter(item => item.status === REPORT_PENDING).length : null,
      clubSubmissions: loadedAt.clubSubmissions !== undefined && clubSubmissionsSchool === undefined
        ? clubSubmissions.filter(item => item.status === SUBMISSION_PENDING).length : null,
      claims: loadedAt.claims !== undefined && claimsSchool === undefined
        ? claims.filter(item => item.status === SUBMISSION_PENDING).length : null,
      positionSubmissions: positions.data?.total ?? null,
      payouts: payouts.data?.total ?? null,
    },
    loadFailed: loadFailed || positions.isError || payouts.isError,
    retry: () => {
      setAttempt(value => value + 1);
      void positions.refetch();
      void payouts.refetch();
    },
  };
}
