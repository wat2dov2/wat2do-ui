"use client";

import { toPng } from "html-to-image";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMMONS_BADGE_COLORS, CommonsPoster } from "@/components/commons-poster";
import { PosterCopyFields } from "@/components/poster-copy-fields";
import type { CommonsPost } from "@/lib/post";
import {
  SUBMISSION_FIELD_LIMITS,
  type CommonsSubmission,
  type EventSubmissionFields,
  type SubmissionStatus,
  type SubmissionUpdate,
  type SubmissionVersionConflictResponse,
} from "@/lib/submissions";

interface SubmissionDraft {
  event: EventSubmissionFields;
  post: CommonsPost;
  badgeColor: string;
}

interface SubmissionDrawerProps {
  submission: CommonsSubmission;
  onClose: () => void;
  onReconciled: (submission: CommonsSubmission) => void;
  onUpdated: (submission: CommonsSubmission) => void;
}

function createDraft(submission: CommonsSubmission): SubmissionDraft {
  return {
    event: { ...submission.event },
    post: { ...submission.post, pills: [...submission.post.pills] },
    badgeColor: submission.badgeColor,
  };
}

function formatTimestamp(value: string | null) {
  if (!value) return "Not yet reviewed";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function SubmissionDrawer({ submission, onClose, onReconciled, onUpdated }: SubmissionDrawerProps) {
  const [baseline, setBaseline] = useState(submission);
  const [draft, setDraft] = useState<SubmissionDraft>(() => createDraft(submission));
  const [conflictSubmission, setConflictSubmission] = useState<CommonsSubmission | null>(null);
  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success">("success");
  const drawerRef = useRef<HTMLElement>(null);
  const posterRef = useRef<HTMLDivElement>(null);
  const editFormId = `submission-edit-${submission.id}`;

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(createDraft(baseline)),
    [baseline, draft],
  );

  const requestClose = useCallback(() => {
    if (isUpdating) {
      setMessageTone("error");
      setMessage("Wait for the current update to finish before closing.");
      return;
    }
    if (isDirty) {
      setShowCloseConfirmation(true);
      return;
    }
    onClose();
  }, [isDirty, isUpdating, onClose]);
  const requestCloseRef = useRef(requestClose);

  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => {
      drawerRef.current?.querySelector<HTMLElement>("button")?.focus();
    });
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestCloseRef.current();
      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !drawerRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const applyUpdate = async (body: SubmissionUpdate, successMessage: string) => {
    setIsUpdating(true);
    setShowCloseConfirmation(false);
    setMessage("");
    try {
      const response = await fetch(`/api/submissions/${submission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as Partial<SubmissionVersionConflictResponse>;
      if (response.status === 409 && result.code === "version-conflict" && result.submission) {
        setConflictSubmission(result.submission);
        onReconciled(result.submission);
        setMessageTone("error");
        setMessage(result.error ?? "This event changed after you opened it. Resolve the conflict below.");
        return;
      }
      if (!response.ok || !result.submission) {
        throw new Error(result.error ?? "The event could not be updated.");
      }

      const updated = result.submission;
      setBaseline(updated);
      setDraft(createDraft(updated));
      setConflictSubmission(null);
      setMessageTone("success");
      setMessage(successMessage);
      onUpdated(updated);
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "The event could not be updated.");
    } finally {
      setIsUpdating(false);
    }
  };

  const saveChanges = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (conflictSubmission) {
      setMessageTone("error");
      setMessage("Choose how to resolve the newer server revision before saving.");
      return;
    }
    await applyUpdate({ type: "edit", version: baseline.version, ...draft }, "Event and poster changes saved.");
  };

  const updateStatus = async (status: SubmissionStatus) => {
    if (conflictSubmission) {
      setMessageTone("error");
      setMessage("Choose how to resolve the newer server revision before changing status.");
      return;
    }
    if (isDirty) {
      setMessageTone("error");
      setMessage("Save your event and poster changes before changing its review status.");
      return;
    }
    await applyUpdate({ type: "review", version: baseline.version, status }, `Event moved to ${status}.`);
  };

  const resolveConflict = (keepDraft: boolean) => {
    if (!conflictSubmission) return;
    const latest = conflictSubmission;
    setBaseline(latest);
    setConflictSubmission(null);
    setShowCloseConfirmation(false);
    setMessageTone("success");
    if (keepDraft) {
      setMessage(`Your edits are preserved on revision ${latest.version}. Review them, then save again.`);
      return;
    }

    setDraft(createDraft(latest));
    setMessage(`Revision ${latest.version} is loaded.`);
    onUpdated(latest);
  };

  const copyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessageTone("success");
      setMessage(successMessage);
    } catch {
      setMessageTone("error");
      setMessage("Copy failed. You can select the text directly from the fields below.");
    }
  };

  const copyEventDetails = () => copyText([
    draft.event.title,
    `Hosted by: ${draft.event.hosts}`,
    `Date: ${draft.event.date}`,
    draft.event.time ? `Time: ${draft.event.time}` : "",
    draft.event.location ? `Location: ${draft.event.location}` : "",
    draft.event.description ? `Description: ${draft.event.description}` : "",
    draft.event.registrationUrl ? `Registration: ${draft.event.registrationUrl}` : "",
    baseline.submitterEmail ? `Contact: ${baseline.submitterEmail}` : "",
  ].filter(Boolean).join("\n"), "Event details copied.");

  const exportPost = async () => {
    if (!posterRef.current) return;
    setIsUpdating(true);
    setMessage("");
    try {
      const dataUrl = await toPng(posterRef.current, {
        canvasWidth: 1080,
        canvasHeight: 1350,
        cacheBust: true,
        pixelRatio: 1,
      });
      const link = document.createElement("a");
      link.download = `${draft.event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      setMessageTone("error");
      setMessage("The post could not be exported. Please try again.");
    } finally {
      setIsUpdating(false);
    }
  };

  const updateEventField = (field: keyof EventSubmissionFields, value: string) => {
    setDraft((current) => ({
      ...current,
      event: { ...current.event, [field]: value },
    }));
  };

  return (
    <div className="review-drawer-layer">
      <button className="review-drawer-overlay" type="button" aria-label="Close event details" onClick={requestClose} />
      <aside
        ref={drawerRef}
        className="review-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-drawer-title"
        tabIndex={-1}
      >
        <header className="review-drawer-header">
          <div>
            <p className="eyebrow">{baseline.source.toUpperCase()} SUBMISSION</p>
            <h2 id="review-drawer-title">{draft.event.title}</h2>
          </div>
          <button type="button" aria-label="Close event details" onClick={requestClose}>×</button>
        </header>

        {showCloseConfirmation && (
          <div className="review-close-confirmation" role="alert">
            <p>Discard your unsaved event and poster changes?</p>
            <div>
              <button className="secondary-button" type="button" onClick={() => setShowCloseConfirmation(false)}>
                KEEP EDITING
              </button>
              <button className="secondary-button reject-button" type="button" onClick={onClose}>
                DISCARD AND CLOSE
              </button>
            </div>
          </div>
        )}

        <div className="review-drawer-scroll">
          <div className="review-drawer-poster">
            <CommonsPoster
              ref={posterRef}
              post={draft.post}
              photoUrl={baseline.coverImageUrl}
              badgeColor={draft.badgeColor}
            />
          </div>

          <div className="review-asset-actions">
            <button className="secondary-button" type="button" onClick={copyEventDetails}>COPY EVENT DETAILS</button>
            <button className="secondary-button" type="button" onClick={() => copyText(draft.post.caption, "Caption copied.")}>COPY CAPTION</button>
            <button className="secondary-button" type="button" onClick={exportPost} disabled={isUpdating}>EXPORT PNG</button>
          </div>

          {message && (
            <p className={`review-message review-message-${messageTone}`} role="status">{message}</p>
          )}

          {conflictSubmission && (
            <div className="review-conflict-actions" role="alert">
              <p>
                Revision {conflictSubmission.version} is newer. Keep your unsaved draft on top of it, or replace
                your draft with the latest saved version.
              </p>
              <div>
                <button className="secondary-button" type="button" onClick={() => resolveConflict(true)}>
                  KEEP MY DRAFT
                </button>
                <button className="secondary-button" type="button" onClick={() => resolveConflict(false)}>
                  LOAD LATEST
                </button>
              </div>
            </div>
          )}

          <dl className="review-details review-metadata">
            <MetadataDetail label="Source" value={baseline.source} />
            <MetadataDetail label="Submitted" value={formatTimestamp(baseline.submittedAt)} />
            <MetadataDetail label="Updated" value={formatTimestamp(baseline.updatedAt)} />
            <MetadataDetail label="Revision" value={String(baseline.version)} />
            <MetadataDetail label="Reviewed" value={formatTimestamp(baseline.reviewedAt)} />
            <MetadataDetail label="Contact email" value={baseline.submitterEmail || "Not provided"} email={Boolean(baseline.submitterEmail)} />
            <MetadataDetail label="Original image" value={baseline.coverImageName || "Template artwork"} />
            <MetadataDetail label="Image asset" value={baseline.coverImageUrl ? "Open original image" : "No uploaded image"} href={baseline.coverImageUrl} />
          </dl>

          <form id={editFormId} className="review-edit-form" onSubmit={saveChanges}>
            <section className="review-edit-section" aria-labelledby={`${editFormId}-event`}>
              <div className="review-edit-heading">
                <p className="eyebrow" id={`${editFormId}-event`}>01 / EVENT DETAILS</p>
                <p>These are the original submission fields.</p>
              </div>
              <div className="studio-fields">
                <DrawerField
                  label="Event title"
                  value={draft.event.title}
                  required
                  maxLength={SUBMISSION_FIELD_LIMITS.title}
                  onChange={(value) => updateEventField("title", value)}
                />
                <DrawerField
                  label="Hosted by"
                  value={draft.event.hosts}
                  required
                  maxLength={SUBMISSION_FIELD_LIMITS.hosts}
                  onChange={(value) => updateEventField("hosts", value)}
                />
                <div className="studio-field-grid">
                  <DrawerField
                    label="Date"
                    value={draft.event.date}
                    required
                    maxLength={SUBMISSION_FIELD_LIMITS.date}
                    onChange={(value) => updateEventField("date", value)}
                  />
                  <DrawerField
                    label="Time"
                    value={draft.event.time}
                    maxLength={SUBMISSION_FIELD_LIMITS.time}
                    onChange={(value) => updateEventField("time", value)}
                  />
                </div>
                <DrawerField
                  label="Location"
                  value={draft.event.location}
                  maxLength={SUBMISSION_FIELD_LIMITS.location}
                  onChange={(value) => updateEventField("location", value)}
                />
                <DrawerField
                  label="Description"
                  value={draft.event.description}
                  multiline
                  rows={5}
                  maxLength={SUBMISSION_FIELD_LIMITS.description}
                  onChange={(value) => updateEventField("description", value)}
                />
                <DrawerField
                  label="Registration link"
                  value={draft.event.registrationUrl}
                  type="url"
                  maxLength={SUBMISSION_FIELD_LIMITS.registrationUrl}
                  onChange={(value) => updateEventField("registrationUrl", value)}
                />
              </div>
            </section>

            <section className="review-edit-section" aria-labelledby={`${editFormId}-poster`}>
              <div className="review-edit-heading">
                <p className="eyebrow" id={`${editFormId}-poster`}>02 / POSTER COPY</p>
                <p>The preview updates here before you save.</p>
              </div>
              <PosterCopyFields
                post={draft.post}
                onChange={(post) => setDraft((current) => ({ ...current, post }))}
              />
            </section>

            <section className="review-edit-section" aria-labelledby={`${editFormId}-colour`}>
              <div className="review-edit-heading">
                <p className="eyebrow" id={`${editFormId}-colour`}>03 / CATEGORY COLOUR</p>
              </div>
              <div className="review-colour-editor">
                <div className="colour-options" role="radiogroup" aria-label="Category colour">
                  {COMMONS_BADGE_COLORS.map((colour) => (
                    <button
                      key={colour.value}
                      className={draft.badgeColor === colour.value ? "colour-option is-active" : "colour-option"}
                      type="button"
                      style={{ backgroundColor: colour.value }}
                      aria-label={colour.name}
                      aria-checked={draft.badgeColor === colour.value}
                      role="radio"
                      onClick={() => setDraft((current) => ({ ...current, badgeColor: colour.value }))}
                    />
                  ))}
                </div>
                <label>
                  <span>Custom colour</span>
                  <input
                    type="color"
                    value={draft.badgeColor}
                    onChange={(event) => setDraft((current) => ({ ...current, badgeColor: event.target.value }))}
                  />
                </label>
              </div>
            </section>
          </form>
        </div>

        <footer className="review-drawer-footer">
          <span className={`status-chip status-${baseline.status}`}>{baseline.status}</span>
          <div>
            {baseline.status !== "rejected" && (
              <button className="secondary-button reject-button" type="button" onClick={() => updateStatus("rejected")} disabled={isUpdating}>
                REJECT
              </button>
            )}
            {baseline.status !== "pending" && (
              <button className="secondary-button" type="button" onClick={() => updateStatus("pending")} disabled={isUpdating}>
                RETURN TO PENDING
              </button>
            )}
            {baseline.status !== "approved" && (
              <button className="secondary-button" type="button" onClick={() => updateStatus("approved")} disabled={isUpdating}>
                APPROVE
              </button>
            )}
            <button className="primary-button" type="submit" form={editFormId} disabled={isUpdating || !isDirty}>
              {isUpdating ? "SAVING..." : "SAVE CHANGES"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function DrawerField({
  label,
  value,
  type = "text",
  required = false,
  multiline = false,
  rows = 1,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="studio-field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          value={value}
          rows={rows}
          required={required}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          value={value}
          type={type}
          required={required}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function MetadataDetail({
  label,
  value,
  email = false,
  href = null,
}: {
  label: string;
  value: string;
  email?: boolean;
  href?: string | null;
}) {
  const target = email ? `mailto:${value}` : href;
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {target ? (
          <a href={target} target={email ? undefined : "_blank"} rel={email ? undefined : "noreferrer"}>
            {value}
          </a>
        ) : value}
      </dd>
    </div>
  );
}
