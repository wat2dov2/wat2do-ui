"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { SubmissionCard } from "@/components/submission-card";
import { SubmissionDrawer } from "@/components/submission-drawer";
import {
  type CommonsSubmission,
  type SubmissionListResponse,
  type SubmissionResponse,
  type SubmissionStatus,
} from "@/lib/submissions";

type AdminSubmissionsView = "feed" | "review";
type ReviewFilter = "all" | SubmissionStatus;
type ApiPayload<T> = Partial<T> & { error?: string };

function submissionsEndpoint(isFeed: boolean, filter: ReviewFilter, cursor?: string) {
  const searchParams = new URLSearchParams({ limit: "24" });
  const status = isFeed ? "approved" : filter === "all" ? null : filter;
  if (status) searchParams.set("status", status);
  if (cursor) searchParams.set("cursor", cursor);
  return `/api/submissions?${searchParams.toString()}`;
}

function submissionIsVisible(
  submission: CommonsSubmission,
  isFeed: boolean,
  filter: ReviewFilter,
) {
  return isFeed ? submission.status === "approved" : filter === "all" || submission.status === filter;
}

function reconcileSubmissionList(
  current: CommonsSubmission[],
  updated: CommonsSubmission,
  visible: boolean,
) {
  if (!visible) return current.filter((submission) => submission.id !== updated.id);
  return current.some((submission) => submission.id === updated.id)
    ? current.map((submission) => submission.id === updated.id ? updated : submission)
    : [updated, ...current];
}

async function readApiPayload<T>(response: Response) {
  return response.json().catch(() => ({})) as Promise<ApiPayload<T>>;
}

export function AdminSubmissionsPage({ view }: { view: AdminSubmissionsView }) {
  const isFeed = view === "feed";
  const [submissions, setSubmissions] = useState<CommonsSubmission[]>([]);
  const [selected, setSelected] = useState<CommonsSubmission | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>(isFeed ? "approved" : "pending");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const listRequestRef = useRef(0);
  const openRequestRef = useRef(0);

  useEffect(() => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    const controller = new AbortController();
    fetch(submissionsEndpoint(isFeed, filter), { signal: controller.signal })
      .then(async (response) => {
        const result = await readApiPayload<SubmissionListResponse>(response);
        if (!response.ok || !result.submissions) {
          throw new Error(result.error ?? "Events could not be loaded.");
        }
        if (listRequestRef.current !== requestId) return;
        setSubmissions(result.submissions);
        setNextCursor(result.nextCursor ?? null);
      })
      .catch((error) => {
        if (
          listRequestRef.current === requestId
          && error instanceof Error
          && error.name !== "AbortError"
        ) {
          setMessage(error.message);
        }
      })
      .finally(() => {
        if (listRequestRef.current === requestId) setIsLoading(false);
      });
    return () => {
      controller.abort();
      if (listRequestRef.current === requestId) listRequestRef.current += 1;
    };
  }, [filter, isFeed]);

  const closeDrawer = useCallback(() => setSelected(null), []);

  const openSubmission = useCallback(async (id: string) => {
    const requestId = openRequestRef.current + 1;
    openRequestRef.current = requestId;
    setOpeningId(id);
    setMessage("");
    try {
      const response = await fetch(`/api/submissions/${id}`);
      const result = await readApiPayload<SubmissionResponse>(response);
      if (!response.ok || !result.submission) {
        throw new Error(result.error ?? "The event could not be opened.");
      }
      if (openRequestRef.current !== requestId) return;
      const submission = result.submission;
      setSubmissions((current) => reconcileSubmissionList(
        current,
        submission,
        submissionIsVisible(submission, isFeed, filter),
      ));
      setSelected(submission);
    } catch (error) {
      if (openRequestRef.current === requestId) {
        setMessage(error instanceof Error ? error.message : "The event could not be opened.");
      }
    } finally {
      if (openRequestRef.current === requestId) setOpeningId(null);
    }
  }, [filter, isFeed]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    const requestId = listRequestRef.current;
    setIsLoadingMore(true);
    setMessage("");
    try {
      const response = await fetch(submissionsEndpoint(isFeed, filter, nextCursor));
      const result = await readApiPayload<SubmissionListResponse>(response);
      if (!response.ok || !result.submissions) {
        throw new Error(result.error ?? "More events could not be loaded.");
      }
      if (listRequestRef.current !== requestId) return;
      const nextSubmissions = result.submissions;
      setSubmissions((current) => {
        const knownIds = new Set(current.map((submission) => submission.id));
        return [...current, ...nextSubmissions.filter((submission) => !knownIds.has(submission.id))];
      });
      setNextCursor(result.nextCursor ?? null);
    } catch (error) {
      if (listRequestRef.current === requestId) {
        setMessage(error instanceof Error ? error.message : "More events could not be loaded.");
      }
    } finally {
      if (listRequestRef.current === requestId) setIsLoadingMore(false);
    }
  }, [filter, isFeed, isLoadingMore, nextCursor]);

  const selectFilter = useCallback((status: ReviewFilter) => {
    if (status === filter) return;
    listRequestRef.current += 1;
    openRequestRef.current += 1;
    setSelected(null);
    setIsLoading(true);
    setIsLoadingMore(false);
    setOpeningId(null);
    setMessage("");
    setSubmissions([]);
    setNextCursor(null);
    setFilter(status);
  }, [filter]);

  const handleUpdated = useCallback((updated: CommonsSubmission) => {
    if (!submissionIsVisible(updated, isFeed, filter)) {
      setSubmissions((current) => reconcileSubmissionList(current, updated, false));
      setSelected(null);
      return;
    }
    setSubmissions((current) => reconcileSubmissionList(current, updated, true));
    setSelected(updated);
  }, [filter, isFeed]);

  const handleReconciled = useCallback((updated: CommonsSubmission) => {
    setSubmissions((current) => reconcileSubmissionList(
      current,
      updated,
      submissionIsVisible(updated, isFeed, filter),
    ));
  }, [filter, isFeed]);

  return (
    <main className="site-page review-page">
      <div className="review-page-content" aria-hidden={selected ? true : undefined}>
        <SiteHeader audience="admin" />

        <section className="page-intro review-intro">
          <div>
            <p className="eyebrow">{isFeed ? "ADMIN / APPROVED FEED" : "ADMIN / EVENT QUEUE"}</p>
            <h1>{isFeed ? "Ready-to-publish events." : "Review the next posts."}</h1>
            <p>
              {isFeed
                ? "Open any approved asset to copy its publishing details, export it, or make a correction."
                : "Open any generated asset to edit its details, caption, and publishing status."}
            </p>
          </div>
        </section>

        {!isFeed && (
          <div className="review-toolbar" aria-label="Review filters">
            {(["pending", "approved", "rejected", "all"] as ReviewFilter[]).map((status) => (
              <button
                key={status}
                className={filter === status ? "is-active" : ""}
                type="button"
                aria-pressed={filter === status}
                onClick={() => selectFilter(status)}
              >
                {status}
              </button>
            ))}
          </div>
        )}

        {message && <p className="review-message" role="alert">{message}</p>}
        {isLoading ? (
          <div className="empty-state"><p className="eyebrow">LOADING EVENTS</p></div>
        ) : submissions.length > 0 ? (
          <div className="submission-grid review-grid" aria-label={isFeed ? "Approved events" : "Event review queue"}>
            {submissions.map((submission) => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                showStatus={!isFeed}
                onSelect={() => void openSubmission(submission.id)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p className="eyebrow">{isFeed ? "NO APPROVED EVENTS" : "QUEUE CLEAR"}</p>
            <h2>{isFeed ? "Approve an event to add it here." : `No ${filter === "all" ? "" : filter} submissions to show.`}</h2>
          </div>
        )}

        {nextCursor && !isLoading && (
          <div className="review-pagination">
            <button className="secondary-button" type="button" disabled={isLoadingMore} onClick={() => void loadMore()}>
              {isLoadingMore ? "LOADING..." : "LOAD MORE EVENTS"}
            </button>
          </div>
        )}
        {openingId && <p className="review-opening" role="status">Opening event details...</p>}
      </div>

      {selected && (
        <SubmissionDrawer
          key={selected.id}
          submission={selected}
          onClose={closeDrawer}
          onReconciled={handleReconciled}
          onUpdated={handleUpdated}
        />
      )}
    </main>
  );
}
