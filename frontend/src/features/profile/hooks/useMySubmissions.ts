import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRequestSchool } from "@/app/client-providers";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { eventPagePath } from "@/features/events";
import { fetchMySubmissions } from "@/features/profile/api/profile.api";
import { rowImage, type ProfileRowImage } from "@/features/profile/hooks/useProfileEvents";
import { clubPagePath, clubPositionsPath } from "@/shared/constants/routes";
import { schoolPageHref } from "@/shared/constants/schools";
import type { ApiSubmissionStatus } from "@/shared/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

/** One thing the visitor submitted, as a profile row. */
export interface ProfileSubmissionRow {
  key: string;
  title: string;
  status: ApiSubmissionStatus;
  submittedAt: string | null;
  image: ProfileRowImage | null;
  /** What its approval made, on its school's site; null until then. */
  href: string | null;
}

/**
 * The visitor's own submissions at every school, newest first, split into
 * events, positions and clubs. An approved one opens what it became: the
 * event's page, the club's positions, or the club's page.
 */
export function useMySubmissions() {
  const { userId } = useAuthState();
  const currentSchool = useRequestSchool();
  const query = useQuery({
    queryKey: queryKeys.mySubmissions.byUser(userId ?? ""),
    queryFn: fetchMySubmissions,
    // Keyed by whose submissions they are, so off until that is known.
    enabled: Boolean(userId),
  });

  return useMemo(() => {
    const approvedHref = (status: ApiSubmissionStatus, school: string | null, path: string | null) =>
      status === "approved" && path ? schoolPageHref(school, path, currentSchool) : null;
    const data = query.data;
    return {
      events: (data?.events ?? []).map<ProfileSubmissionRow>((event) => ({
        key: event.id,
        title: event.title,
        status: event.status,
        submittedAt: event.submitted_at,
        image: rowImage(event.source_image_url, event.club_logo_url),
        href: approvedHref(event.status, event.school, event.event_id === null ? null : eventPagePath(event.event_id)),
      })),
      positions: (data?.positions ?? []).map<ProfileSubmissionRow>((position) => ({
        key: position.id,
        title: position.title,
        status: position.status,
        submittedAt: position.submitted_at,
        image: rowImage(position.source_image_url, position.club_logo_url),
        href: approvedHref(position.status, position.school, position.club_id === null ? null : clubPositionsPath(position.club_id)),
      })),
      clubs: (data?.clubs ?? []).map<ProfileSubmissionRow>((club) => ({
        key: String(club.id),
        title: club.club_name,
        status: club.status,
        submittedAt: club.submitted_at,
        image: rowImage(null, club.logo_url),
        href: approvedHref(club.status, club.school, clubPagePath(club.id)),
      })),
      isPending: query.isPending,
    };
  }, [currentSchool, query.data, query.isPending]);
}
