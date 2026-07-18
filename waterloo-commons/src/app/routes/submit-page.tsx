"use client";

import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { createSubmissionPost } from "@/lib/create-submission-post";
import {
  ACCEPTED_COVER_IMAGE_MIME_TYPES,
  MAX_COVER_IMAGE_SIZE_BYTES,
  MAX_COVER_IMAGE_NAME_LENGTH,
  normaliseEventSubmissionFields,
  normaliseSubmitterEmail,
  SUBMISSION_FIELD_LIMITS,
  type CoverImageMimeType,
  type EventSubmissionFields,
  type SubmissionAlreadyFinalizedResponse,
  type SubmissionFinalize,
  type SubmissionFinalizeResponse,
  type SubmissionUploadGrant,
  type SubmissionUploadIntent,
  type SubmissionUploadResponse,
} from "@/lib/submissions";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

interface RequestFailure extends Error {
  retryAfterSeconds?: number;
  status?: number;
}

type SubmissionStage = "idle" | "authorizing" | "uploading" | "finalizing";

const SUBMISSION_BUTTON_LABELS: Record<SubmissionStage, string> = {
  idle: "SUBMIT EVENT",
  authorizing: "PREPARING UPLOAD...",
  uploading: "UPLOADING IMAGE...",
  finalizing: "CREATING ASSET...",
};

function requestFailure(message: string, response?: Response): RequestFailure {
  const error = new Error(message) as RequestFailure;
  error.status = response?.status;
  const retryAfter = Number(response?.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterSeconds = retryAfter;
  return error;
}

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function eventFromForm(formData: FormData): EventSubmissionFields {
  return {
    title: formText(formData, "title"),
    hosts: formText(formData, "hosts"),
    date: formText(formData, "date"),
    time: formText(formData, "time"),
    location: formText(formData, "location"),
    description: formText(formData, "description"),
    registrationUrl: formText(formData, "registrationUrl"),
  };
}

function coverImageFromForm(formData: FormData) {
  const file = formData.get("coverImage");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a cover image.");
  if (file.size > MAX_COVER_IMAGE_SIZE_BYTES) throw new Error("The cover image must be 10 MB or smaller.");
  if (file.name.length > MAX_COVER_IMAGE_NAME_LENGTH) throw new Error("The cover image file name is too long.");
  if (!ACCEPTED_COVER_IMAGE_MIME_TYPES.includes(file.type as CoverImageMimeType)) {
    throw new Error("Upload a PNG, JPEG, or WebP image.");
  }
  return file as File & { type: CoverImageMimeType };
}

async function responseJson<T>(response: Response, fallbackMessage: string) {
  try {
    return await response.json() as T;
  } catch {
    throw requestFailure(fallbackMessage, response.ok ? undefined : response);
  }
}

async function createUploadGrant(file: File & { type: CoverImageMimeType }) {
  const intent: SubmissionUploadIntent = {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
  };
  const response = await fetch("/api/submission-uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(intent),
  });
  const result = await responseJson<Partial<SubmissionUploadResponse> & { error?: string }>(
    response,
    "The upload service returned an unreadable response.",
  );
  if (!response.ok || !result.upload) {
    throw requestFailure(result.error ?? "The image upload could not be started.", response);
  }
  return result.upload;
}

async function uploadCoverImage(grant: SubmissionUploadGrant, file: File) {
  const { error } = await getSupabaseBrowserClient()
    .storage
    .from(grant.bucket)
    .uploadToSignedUrl(grant.uploadPath, grant.uploadToken, file, { contentType: file.type });
  if (error) throw new Error("The cover image could not be uploaded. Please try again.");
}

function retryableFinalizeFailure(error: RequestFailure) {
  return error.status === undefined
    || error.status >= 500
    || (error.status === 409 && error.retryAfterSeconds !== undefined);
}

async function waitForRetry(seconds: number) {
  await new Promise((resolve) => window.setTimeout(resolve, Math.min(seconds, 5) * 1_000));
}

async function finalizeSubmission(payload: SubmissionFinalize) {
  let lastFailure: RequestFailure | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await responseJson<
        Partial<SubmissionFinalizeResponse & SubmissionAlreadyFinalizedResponse> & { error?: string }
      >(
        response,
        "The submission service returned an unreadable response.",
      );
      if (response.ok) {
        if (result.ok && result.submissionId === payload.submissionId) return "saved" as const;
        throw requestFailure("The submission service did not confirm the saved event.");
      }
      if (
        response.status === 409
        && result.code === "submission-already-finalized"
        && result.submissionId === payload.submissionId
      ) {
        return "already-finalized" as const;
      }

      const failure = requestFailure(result.error ?? "The event could not be submitted.", response);
      if (attempt === 0 && retryableFinalizeFailure(failure)) {
        lastFailure = failure;
        await waitForRetry(failure.retryAfterSeconds ?? 1);
        continue;
      }
      throw failure;
    } catch (error) {
      const failure = error instanceof Error ? error as RequestFailure : requestFailure("The event could not be submitted.");
      if (attempt === 0 && retryableFinalizeFailure(failure)) {
        lastFailure = failure;
        await waitForRetry(failure.retryAfterSeconds ?? 1);
        continue;
      }
      throw failure;
    }
  }

  throw lastFailure ?? requestFailure("The event could not be submitted.");
}

export default function SubmitPage() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [wasAlreadyFinalized, setWasAlreadyFinalized] = useState(false);
  const [submissionStage, setSubmissionStage] = useState<SubmissionStage>("idle");
  const [hasPendingFinalize, setHasPendingFinalize] = useState(false);
  const previewUrlRef = useRef<string | null>(null);
  const pendingFinalizeRef = useRef<SubmissionFinalize | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (!file) {
      previewUrlRef.current = null;
      setImagePreview(null);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    previewUrlRef.current = previewUrl;
    setImagePreview(previewUrl);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setIsSubmitting(true);
    setMessage("");

    try {
      let finalizePayload = pendingFinalizeRef.current;

      if (!finalizePayload) {
        const formData = new FormData(form);
        const eventFields = normaliseEventSubmissionFields(eventFromForm(formData));
        createSubmissionPost(eventFields);
        const submitterEmail = normaliseSubmitterEmail(formText(formData, "submitterEmail"));
        const coverImage = coverImageFromForm(formData);
        setSubmissionStage("authorizing");
        const grant = await createUploadGrant(coverImage);
        setSubmissionStage("uploading");
        await uploadCoverImage(grant, coverImage);
        finalizePayload = {
          submissionId: crypto.randomUUID(),
          uploadId: grant.uploadId,
          finalizeToken: grant.finalizeToken,
          submitterEmail,
          event: eventFields,
        };
        pendingFinalizeRef.current = finalizePayload;
        setHasPendingFinalize(true);
      }

      setSubmissionStage("finalizing");
      const finalizeOutcome = await finalizeSubmission(finalizePayload);

      pendingFinalizeRef.current = null;
      setHasPendingFinalize(false);
      setWasAlreadyFinalized(finalizeOutcome === "already-finalized");
      setIsSubmitted(true);
      form.reset();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setImagePreview(null);
    } catch (error) {
      const failure = error instanceof Error ? error as RequestFailure : null;
      if (
        failure?.status !== undefined
        && failure.status < 500
        && !(failure.status === 409 && failure.retryAfterSeconds !== undefined)
      ) {
        pendingFinalizeRef.current = null;
        setHasPendingFinalize(false);
      }
      const retryHint = pendingFinalizeRef.current
        ? " Retry to finish the same uploaded submission."
        : "";
      setMessage(`${error instanceof Error ? error.message : "The event could not be submitted."}${retryHint}`);
    } finally {
      setSubmissionStage("idle");
      setIsSubmitting(false);
    }
  };

  return (
    <main className="site-page">
      <SiteHeader audience="public" />

      <section className="submission-page-layout">
        <div className="submission-intro">
          <p className="eyebrow">WATERLOO COMMONS</p>
          <h1>Event Submission</h1>
          <p className="submission-lede">
            Submit an event to Waterloo Commons. It could be one that you’re running, or an event that you came
            across that you think more people should know about.
          </p>
          <div className="submission-note">
            <strong>Already have an Instagram post?</strong>
            <p>You can send it to the curators with a picture when it already contains all the details below.</p>
          </div>
          <p className="submission-discretion">
            Inclusion in Waterloo Commons posts is at the discretion of the curators.
          </p>
        </div>

        {isSubmitted ? (
          <section className="submission-success" aria-live="polite">
            <p className="eyebrow">SUBMISSION RECEIVED</p>
            <h2>Your Commons asset and caption are ready for review.</h2>
            <p>
              {wasAlreadyFinalized
                ? "Waterloo Commons already received the original event. The retry did not replace it with newer browser values."
                : "The event is in the curator queue as pending. The curators will review its generated post before publishing it."}
            </p>
            <div className="submission-success-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  setWasAlreadyFinalized(false);
                  setIsSubmitted(false);
                }}
              >
                Submit another event
              </button>
            </div>
          </section>
        ) : (
          <form className="commons-form" onSubmit={handleSubmit}>
            <fieldset className="submission-fields" disabled={isSubmitting || hasPendingFinalize}>
              <p className="required-note"><span>*</span> Indicates a required question</p>
              <p className="form-account-note">
                Your contact email is recorded with the submission so curators can follow up about the event.
              </p>

              <FormField
                label="Contact Email"
                name="submitterEmail"
                type="email"
                required
                maxLength={SUBMISSION_FIELD_LIMITS.submitterEmail}
              />
              <FormField
                label="Event Title"
                name="title"
                required
                maxLength={SUBMISSION_FIELD_LIMITS.title}
              />
              <FormField
                label="Hosted by?"
                name="hosts"
                required
                maxLength={SUBMISSION_FIELD_LIMITS.hosts}
                hint="If the event is hosted by several organizations in collaboration, please list all of them. :)"
              />
              <FormField
                label="Date"
                name="date"
                required
                maxLength={SUBMISSION_FIELD_LIMITS.date}
                placeholder="Tue, June 10"
                hint="If it spans multiple days, restate the month, for example June 10 - June 11."
              />
              <FormField
                label="Time"
                name="time"
                maxLength={SUBMISSION_FIELD_LIMITS.time}
                placeholder="4:00 PM - 6:30 PM"
              />
              <FormField
                label="Location"
                name="location"
                maxLength={SUBMISSION_FIELD_LIMITS.location}
                placeholder="Waterloo Park, Silver Lake Fountain"
                hint="A location name is better than an address, unless the address is required."
              />
              <FormField
                label="Event Description"
                name="description"
                optional
                maxLength={SUBMISSION_FIELD_LIMITS.description}
                hint="Added to the caption, so keep it short and sweet."
                multiline
              />
              <FormField
                label="Registration Link"
                name="registrationUrl"
                type="url"
                optional
                maxLength={SUBMISSION_FIELD_LIMITS.registrationUrl}
                hint="If your event requires registration, link it here."
              />

              <div className="form-field">
                <label htmlFor="coverImage">Send us a cover image <span>*</span></label>
                <p>The image should be plain with no text. Please do not send a poster.</p>
                <p>
                  Choose something that captures the vibe, ideally a photo from a previous event or another image that
                  fits what you’re doing.
                </p>
                <label className={imagePreview ? "cover-upload has-preview" : "cover-upload"} htmlFor="coverImage">
                  {imagePreview ? <img src={imagePreview} alt="Selected cover preview" /> : <span>+ CHOOSE IMAGE</span>}
                </label>
                <input
                  className="visually-hidden"
                  id="coverImage"
                  name="coverImage"
                  type="file"
                  accept={ACCEPTED_COVER_IMAGE_MIME_TYPES.join(",")}
                  required
                  onChange={handleImageChange}
                />
                <small>PNG, JPEG, or WebP. Maximum 10 MB.</small>
              </div>
            </fieldset>

            {hasPendingFinalize && (
              <p className="form-account-note pending-finalize-note">
                Your image and event details are locked for a safe retry. Retry to finish the same submission.
              </p>
            )}
            {message && <p className="form-error" role="alert">{message}</p>}
            <button className="generate-button submit-event-button" type="submit" disabled={isSubmitting}>
              {submissionStage === "idle" && hasPendingFinalize
                ? "RETRY SUBMISSION"
                : SUBMISSION_BUTTON_LABELS[submissionStage]}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function FormField({
  label,
  name,
  required = false,
  optional = false,
  hint,
  multiline = false,
  type = "text",
  placeholder,
  maxLength,
}: {
  label: string;
  name: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  multiline?: boolean;
  type?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <div className="form-field">
      <label htmlFor={name}>
        {optional && <span className="optional-label">(optional) </span>}
        {label} {required && <span>*</span>}
      </label>
      {hint && <p>{hint}</p>}
      {multiline ? (
        <textarea id={name} name={name} rows={4} required={required} maxLength={maxLength} />
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          required={required}
          maxLength={maxLength}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
