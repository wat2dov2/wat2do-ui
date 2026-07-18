"use client";

import { CommonsPoster } from "@/components/commons-poster";
import type { CommonsSubmission } from "@/lib/submissions";

interface SubmissionCardProps {
  submission: CommonsSubmission;
  onSelect: () => void;
  showStatus?: boolean;
}

function submittedDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function SubmissionCard({ submission, onSelect, showStatus = false }: SubmissionCardProps) {
  return (
    <button
      className="submission-card submission-card-button"
      type="button"
      aria-label={`Open details for ${submission.event.title}`}
      onClick={onSelect}
    >
      <div className="submission-card-poster">
        <CommonsPoster
          post={submission.post}
          photoUrl={submission.coverImageUrl}
          badgeColor={submission.badgeColor}
        />
      </div>
      <div className="submission-card-meta">
        <div>
          <p className="submission-card-host">{submission.event.hosts}</p>
          <h2>{submission.event.title}</h2>
        </div>
        {showStatus && <span className={`status-chip status-${submission.status}`}>{submission.status}</span>}
        <p>{submission.event.date}{submission.event.time ? ` · ${submission.event.time}` : ""}</p>
        <p>{submission.event.location || "Location to be confirmed"}</p>
        <small>Submitted {submittedDate(submission.submittedAt)}</small>
      </div>
    </button>
  );
}
