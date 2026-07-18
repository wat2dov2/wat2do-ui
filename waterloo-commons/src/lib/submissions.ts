import { Constants, type Database, type Json } from "@/lib/database.types";
import { assertExactJsonKeys, readJsonObject, readJsonString } from "@/lib/json-contract";
import { normalisePost, type CommonsPost } from "@/lib/post";

export type SubmissionStatus = Database["public"]["Enums"]["commons_submission_status"];
export type SubmissionSource = Database["public"]["Enums"]["commons_submission_source"];

export interface EventSubmissionFields {
  title: string;
  hosts: string;
  date: string;
  time: string;
  location: string;
  description: string;
  registrationUrl: string;
}

const EVENT_SUBMISSION_KEYS = [
  "title",
  "hosts",
  "date",
  "time",
  "location",
  "description",
  "registrationUrl",
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINALIZE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UPLOAD_CURSOR_SEPARATOR = "|";

export const ACCEPTED_COVER_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type CoverImageMimeType = typeof ACCEPTED_COVER_IMAGE_MIME_TYPES[number];

export const COVER_IMAGE_QUARANTINE_BUCKET = "commons-event-image-quarantine";

export interface SubmissionUploadGrant {
  bucket: typeof COVER_IMAGE_QUARANTINE_BUCKET;
  uploadId: string;
  uploadPath: string;
  uploadToken: string;
  finalizeToken: string;
  expiresAt: string;
}

export interface SubmissionUploadResponse {
  upload: SubmissionUploadGrant;
}

export const SUBMISSION_STATUSES = Constants.public.Enums.commons_submission_status;

export const SUBMISSION_FIELD_LIMITS = {
  submitterEmail: 254,
  title: 70,
  hosts: 80,
  date: 40,
  time: 40,
  location: 80,
  description: 400,
  registrationUrl: 2048,
} as const;

export const MAX_COVER_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_COVER_IMAGE_NAME_LENGTH = 255;
export const DEFAULT_SUBMISSION_PAGE_SIZE = 24;
export const MAX_SUBMISSION_PAGE_SIZE = 50;

export interface CommonsSubmission {
  id: string;
  source: SubmissionSource;
  status: SubmissionStatus;
  submittedAt: string;
  updatedAt: string;
  updatedBy: string | null;
  version: number;
  reviewedAt: string | null;
  submitterEmail: string | null;
  event: EventSubmissionFields;
  coverImageUrl: string | null;
  coverImageName: string | null;
  badgeColor: string;
  post: CommonsPost;
}

export interface SubmissionUploadIntent {
  fileName: string;
  fileSize: number;
  mimeType: CoverImageMimeType;
}

export interface SubmissionFinalize {
  submissionId: string;
  uploadId: string;
  finalizeToken: string;
  submitterEmail: string;
  event: EventSubmissionFields;
}

export interface SubmissionFinalizeResponse {
  ok: true;
  submissionId: string;
}

export interface SubmissionAlreadyFinalizedResponse {
  code: "submission-already-finalized";
  error: string;
  submissionId: string;
}

export type SubmissionUpdate =
  | {
      type: "edit";
      version: number;
      event: EventSubmissionFields;
      post: CommonsPost;
      badgeColor: string;
    }
  | {
      type: "review";
      version: number;
      status: SubmissionStatus;
    };

export interface SubmissionListCursor {
  submittedAt: string;
  id: string;
}

export interface SubmissionListQuery {
  status?: SubmissionStatus;
  cursor?: SubmissionListCursor;
  limit: number;
}

export interface SubmissionListResponse {
  submissions: CommonsSubmission[];
  nextCursor: string | null;
}

export interface SubmissionResponse {
  submission: CommonsSubmission;
}

export interface SubmissionVersionConflictResponse extends SubmissionResponse {
  code: "version-conflict";
  error: string;
}

function readJsonNumber(value: Record<string, unknown>, key: string, label: string) {
  const field = value[key];
  if (typeof field !== "number" || !Number.isSafeInteger(field)) {
    throw new Error(`${label}.${key} must be an integer.`);
  }
  return field;
}

function normaliseUuid(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${label} must be a valid UUID.`);
  return normalized;
}

export function normaliseSubmitterEmail(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new Error("Contact email is required.");
  if (normalized.length > SUBMISSION_FIELD_LIMITS.submitterEmail) {
    throw new Error("submitterEmail is too long.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Enter a valid contact email.");
  }
  return normalized;
}

function isCoverImageMimeType(value: unknown): value is CoverImageMimeType {
  return typeof value === "string"
    && ACCEPTED_COVER_IMAGE_MIME_TYPES.includes(value as CoverImageMimeType);
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function isSubmissionStatus(value: unknown): value is SubmissionStatus {
  return typeof value === "string" && SUBMISSION_STATUSES.includes(value as SubmissionStatus);
}

export function parseEventSubmissionFields(value: Json): EventSubmissionFields {
  const event = readJsonObject(value, "submission event");
  return {
    title: readJsonString(event, "title", "submission event"),
    hosts: readJsonString(event, "hosts", "submission event"),
    date: readJsonString(event, "date", "submission event"),
    time: readJsonString(event, "time", "submission event"),
    location: readJsonString(event, "location", "submission event"),
    description: readJsonString(event, "description", "submission event"),
    registrationUrl: readJsonString(event, "registrationUrl", "submission event"),
  };
}

export function normaliseEventSubmissionFields(value: unknown): EventSubmissionFields {
  const input = readJsonObject(value, "event");
  assertExactJsonKeys(input, EVENT_SUBMISSION_KEYS, "event");

  const event: EventSubmissionFields = {
    title: readJsonString(input, "title", "event").trim(),
    hosts: readJsonString(input, "hosts", "event").trim(),
    date: readJsonString(input, "date", "event").trim(),
    time: readJsonString(input, "time", "event").trim(),
    location: readJsonString(input, "location", "event").trim(),
    description: readJsonString(input, "description", "event").trim(),
    registrationUrl: readJsonString(input, "registrationUrl", "event").trim(),
  };

  if (!event.title || !event.hosts || !event.date) {
    throw new Error("Event title, host, and date are required.");
  }

  const oversizedField = EVENT_SUBMISSION_KEYS.find(
    (field) => event[field].length > SUBMISSION_FIELD_LIMITS[field],
  );
  if (oversizedField) throw new Error(`event.${oversizedField} is too long.`);

  if (event.registrationUrl) {
    let registrationUrl: URL;
    try {
      registrationUrl = new URL(event.registrationUrl);
    } catch {
      throw new Error("Registration link must be a valid HTTP or HTTPS URL.");
    }
    if (registrationUrl.protocol !== "http:" && registrationUrl.protocol !== "https:") {
      throw new Error("Registration link must be a valid HTTP or HTTPS URL.");
    }
  }

  return event;
}

export function parseSubmissionUploadIntent(value: unknown): SubmissionUploadIntent {
  const input = readJsonObject(value, "upload intent");
  assertExactJsonKeys(input, ["fileName", "fileSize", "mimeType"], "upload intent");

  const fileName = readJsonString(input, "fileName", "upload intent").trim();
  const fileSize = readJsonNumber(input, "fileSize", "upload intent");
  const mimeType = input.mimeType;

  if (!fileName || fileName.length > MAX_COVER_IMAGE_NAME_LENGTH || hasControlCharacter(fileName)) {
    throw new Error("Choose an image with a valid file name.");
  }
  if (fileSize < 1 || fileSize > MAX_COVER_IMAGE_SIZE_BYTES) {
    throw new Error("The cover image must be 10 MB or smaller.");
  }
  if (!isCoverImageMimeType(mimeType)) {
    throw new Error("Upload a PNG, JPEG, or WebP image.");
  }
  return { fileName, fileSize, mimeType };
}

export function parseSubmissionFinalize(value: unknown): SubmissionFinalize {
  const input = readJsonObject(value, "submission");
  assertExactJsonKeys(
    input,
    ["submissionId", "uploadId", "finalizeToken", "submitterEmail", "event"],
    "submission",
  );

  const finalizeToken = readJsonString(input, "finalizeToken", "submission").trim();
  if (!FINALIZE_TOKEN_PATTERN.test(finalizeToken)) {
    throw new Error("The upload confirmation is invalid or expired.");
  }

  return {
    submissionId: normaliseUuid(
      readJsonString(input, "submissionId", "submission"),
      "submission.submissionId",
    ),
    uploadId: normaliseUuid(
      readJsonString(input, "uploadId", "submission"),
      "submission.uploadId",
    ),
    finalizeToken,
    submitterEmail: normaliseSubmitterEmail(
      readJsonString(input, "submitterEmail", "submission"),
    ),
    event: normaliseEventSubmissionFields(input.event),
  };
}

export function parseSubmissionUpdate(value: unknown): SubmissionUpdate {
  const input = readJsonObject(value, "submission update");
  const type = readJsonString(input, "type", "submission update");
  const version = readJsonNumber(input, "version", "submission update");
  if (version < 1) throw new Error("submission update.version must be positive.");

  if (type === "edit") {
    assertExactJsonKeys(input, ["type", "version", "event", "post", "badgeColor"], "submission update");
    const badgeColor = readJsonString(input, "badgeColor", "submission update").trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(badgeColor)) {
      throw new Error("Badge color must be a six-digit hex color.");
    }

    return {
      type,
      version,
      event: normaliseEventSubmissionFields(input.event),
      post: normalisePost(input.post),
      badgeColor,
    };
  }

  if (type === "review") {
    assertExactJsonKeys(input, ["type", "version", "status"], "submission update");
    const status = input.status;
    if (!isSubmissionStatus(status)) throw new Error("Choose a valid review status.");
    return { type, version, status };
  }

  throw new Error("Choose a valid submission update type.");
}

export function createSubmissionCursor(submission: Pick<CommonsSubmission, "id" | "submittedAt">) {
  return `${new Date(submission.submittedAt).toISOString()}${UPLOAD_CURSOR_SEPARATOR}${submission.id}`;
}

export function parseSubmissionCursor(value: string): SubmissionListCursor {
  const separatorIndex = value.indexOf(UPLOAD_CURSOR_SEPARATOR);
  if (separatorIndex < 1) throw new Error("The submission cursor is invalid.");

  const submittedAtValue = value.slice(0, separatorIndex);
  const idValue = value.slice(separatorIndex + 1);
  const submittedAt = new Date(submittedAtValue);
  if (Number.isNaN(submittedAt.getTime())) throw new Error("The submission cursor is invalid.");

  return {
    submittedAt: submittedAt.toISOString(),
    id: normaliseUuid(idValue, "cursor id"),
  };
}

export function parseSubmissionListQuery(searchParams: URLSearchParams): SubmissionListQuery {
  const statusValue = searchParams.get("status");
  const cursorValue = searchParams.get("cursor");
  const limitValue = searchParams.get("limit");

  let status: SubmissionStatus | undefined;
  if (statusValue) {
    if (!isSubmissionStatus(statusValue)) throw new Error("Unknown submission status.");
    status = statusValue;
  }

  let limit = DEFAULT_SUBMISSION_PAGE_SIZE;
  if (limitValue !== null) {
    if (!/^\d+$/.test(limitValue)) throw new Error("Submission limit must be an integer.");
    limit = Number(limitValue);
    if (limit < 1 || limit > MAX_SUBMISSION_PAGE_SIZE) {
      throw new Error(`Submission limit must be between 1 and ${MAX_SUBMISSION_PAGE_SIZE}.`);
    }
  }

  return {
    status,
    cursor: cursorValue ? parseSubmissionCursor(cursorValue) : undefined,
    limit,
  };
}

export function parseSubmissionId(value: string) {
  return normaliseUuid(value, "Submission ID");
}
