import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Database, Json } from "@/lib/database.types";
import { parseCommonsPost, type CommonsPost } from "@/lib/post";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import {
  createSubmissionCursor,
  COVER_IMAGE_QUARANTINE_BUCKET,
  MAX_COVER_IMAGE_SIZE_BYTES,
  parseEventSubmissionFields,
  type CommonsSubmission,
  type CoverImageMimeType,
  type SubmissionFinalize,
  type SubmissionListQuery,
  type SubmissionListResponse,
  type SubmissionUpdate,
  type SubmissionUploadGrant,
  type SubmissionUploadIntent,
} from "@/lib/submissions";

const FINAL_IMAGE_BUCKET = "commons-event-images";
const MAX_IMAGE_PIXELS = 20_000_000;
const MAX_OUTPUT_WIDTH = 2160;
const MAX_OUTPUT_HEIGHT = 2700;
const PROCESSING_LEASE_MILLISECONDS = 5 * 60 * 1000;
const SIGNED_UPLOAD_TOKEN_LIFETIME_MILLISECONDS = 2 * 60 * 60 * 1000;
const SIGNED_UPLOAD_CLEANUP_GRACE_MILLISECONDS = (
  SIGNED_UPLOAD_TOKEN_LIFETIME_MILLISECONDS + (15 * 60 * 1000)
);
const CONSUMED_UPLOAD_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_RETENTION_MILLISECONDS = 2 * 24 * 60 * 60 * 1000;
const SIGNED_IMAGE_LIFETIME_SECONDS = 60 * 60;

const MIME_TYPE_EXTENSIONS: Record<CoverImageMimeType, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const FORMAT_MIME_TYPES = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

type CommonsSubmissionRow = Database["public"]["Tables"]["commons_submissions"]["Row"];
type CommonsUploadSessionRow = Database["public"]["Tables"]["commons_upload_sessions"]["Row"];

function databaseError(operation: string, message: string) {
  return new Error(`Supabase ${operation} failed: ${message}`);
}

function finalizeTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export class CoverImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverImageValidationError";
  }
}

export type UploadSessionErrorCode = "conflict" | "expired" | "invalid" | "processing";

export class UploadSessionError extends Error {
  constructor(
    message: string,
    readonly code: UploadSessionErrorCode,
  ) {
    super(message);
    this.name = "UploadSessionError";
  }
}

export class SubmissionIdentityConflictError extends Error {
  constructor() {
    super("That submission identifier is already in use.");
    this.name = "SubmissionIdentityConflictError";
  }
}

export class SubmissionReplayConflictError extends Error {
  constructor(readonly submissionId: string) {
    super("That upload was already finalized with different submission details.");
    this.name = "SubmissionReplayConflictError";
  }
}

async function signedImageUrls(paths: string[]) {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) return new Map<string, string>();

  const { data, error } = await getSupabaseAdminClient()
    .storage
    .from(FINAL_IMAGE_BUCKET)
    .createSignedUrls(uniquePaths, SIGNED_IMAGE_LIFETIME_SECONDS);
  if (error) {
    console.error("Supabase signed URL creation failed", error.message);
    return new Map<string, string>();
  }

  const urls = new Map<string, string>();
  data.forEach((item) => {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
    if (item.error) console.error("Supabase signed URL creation failed", item.error);
  });
  return urls;
}

function toSubmission(
  row: CommonsSubmissionRow,
  signedUrls: ReadonlyMap<string, string>,
): CommonsSubmission {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    version: row.version,
    reviewedAt: row.reviewed_at,
    submitterEmail: row.submitter_email,
    event: parseEventSubmissionFields(row.event),
    coverImageUrl: row.cover_image_path ? signedUrls.get(row.cover_image_path) ?? null : null,
    coverImageName: row.cover_image_name,
    badgeColor: row.badge_color,
    post: parseCommonsPost(row.post),
  };
}

async function toSubmissions(rows: CommonsSubmissionRow[]) {
  const urls = await signedImageUrls(
    rows.flatMap((row) => row.cover_image_path ? [row.cover_image_path] : []),
  );
  return rows.map((row) => toSubmission(row, urls));
}

export async function prepareCoverImage(input: Buffer, claimedMimeType: CoverImageMimeType) {
  if (input.byteLength === 0) throw new CoverImageValidationError("The cover image is empty.");
  if (input.byteLength > MAX_COVER_IMAGE_SIZE_BYTES) {
    throw new CoverImageValidationError("The cover image must be 10 MB or smaller.");
  }

  const source = sharp(input, {
    animated: false,
    failOn: "error",
    limitInputPixels: MAX_IMAGE_PIXELS,
  });
  const metadata = await source.metadata().catch(() => null);
  const format = metadata?.format;
  if (!format || !(format in FORMAT_MIME_TYPES)) {
    throw new CoverImageValidationError("Upload a PNG, JPEG, or WebP image.");
  }
  if ((metadata.pages ?? 1) !== 1) {
    throw new CoverImageValidationError("Animated or multi-page images are not supported.");
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
    throw new CoverImageValidationError("The cover image dimensions are too large.");
  }

  const detectedMimeType = FORMAT_MIME_TYPES[format as keyof typeof FORMAT_MIME_TYPES];
  if (claimedMimeType !== detectedMimeType) {
    throw new CoverImageValidationError("The image contents do not match its file type.");
  }

  const bytes = await source
    .rotate()
    .resize({
      width: MAX_OUTPUT_WIDTH,
      height: MAX_OUTPUT_HEIGHT,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ effort: 4, quality: 88 })
    .toBuffer()
    .catch(() => {
      throw new CoverImageValidationError("The cover image could not be processed.");
    });
  if (bytes.byteLength > MAX_COVER_IMAGE_SIZE_BYTES) {
    throw new CoverImageValidationError("The prepared cover image must be 10 MB or smaller.");
  }

  return { bytes, contentType: "image/webp" as const };
}

async function removeStorageObject(bucket: string, path: string) {
  const { error } = await getSupabaseAdminClient().storage.from(bucket).remove([path]);
  if (error) {
    console.error("Supabase image cleanup failed", bucket, error.message);
    return false;
  }
  return true;
}

async function deleteUploadSession(id: string) {
  const { error } = await getSupabaseAdminClient()
    .from("commons_upload_sessions")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("Supabase upload session cleanup failed", error.message);
    return false;
  }
  return true;
}

export async function cleanupSubmissionEphemeralState(limit = 10) {
  const cleanupCounts = {
    expiredUploadsProcessed: 0,
    consumedSessionsDeleted: 0,
    staleRateLimitsDeleted: 0,
  };
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const abandonedBefore = new Date(
    nowDate.getTime() - PROCESSING_LEASE_MILLISECONDS,
  ).toISOString();
  const signedUploadExpiredBefore = new Date(
    nowDate.getTime() - SIGNED_UPLOAD_CLEANUP_GRACE_MILLISECONDS,
  ).toISOString();
  const { data, error } = await getSupabaseAdminClient()
    .from("commons_upload_sessions")
    .select("id, upload_path, requested_submission_id")
    .lt("expires_at", now)
    .lt("created_at", signedUploadExpiredBefore)
    .is("consumed_at", null)
    .or(`processing_at.is.null,processing_at.lt.${abandonedBefore}`)
    .order("expires_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.error("Supabase expired upload listing failed", error.message);
    return cleanupCounts;
  }

  for (const session of data) {
    const { data: submission, error: submissionError } = await getSupabaseAdminClient()
      .from("commons_submissions")
      .select("id")
      .eq("upload_session_id", session.id)
      .maybeSingle();
    if (submissionError) {
      console.error("Supabase expired upload lookup failed", submissionError.message);
      continue;
    }

    const quarantineRemoved = await removeStorageObject(
      COVER_IMAGE_QUARANTINE_BUCKET,
      session.upload_path,
    );
    if (submission) {
      const { error: consumeError } = await getSupabaseAdminClient()
        .from("commons_upload_sessions")
        .update({ consumed_at: now, processing_at: null })
        .eq("id", session.id)
        .is("consumed_at", null);
      if (consumeError) {
        console.error("Supabase upload completion recovery failed", consumeError.message);
      } else {
        cleanupCounts.expiredUploadsProcessed += 1;
      }
      continue;
    }

    let finalImageRemoved = true;
    if (session.requested_submission_id) {
      finalImageRemoved = await removeStorageObject(FINAL_IMAGE_BUCKET, `${session.id}.webp`);
    }
    if (!quarantineRemoved || !finalImageRemoved) {
      continue;
    }
    if (await deleteUploadSession(session.id)) {
      cleanupCounts.expiredUploadsProcessed += 1;
    }
  }

  const consumedBefore = new Date(Date.now() - CONSUMED_UPLOAD_RETENTION_MILLISECONDS).toISOString();
  const { data: consumedSessions, error: consumedCleanupError } = await getSupabaseAdminClient()
    .from("commons_upload_sessions")
    .select("id, upload_path")
    .lt("consumed_at", consumedBefore)
    .order("consumed_at", { ascending: true })
    .limit(limit);
  if (consumedCleanupError) {
    console.error("Supabase consumed upload session listing failed", consumedCleanupError.message);
  } else {
    for (const session of consumedSessions) {
      const quarantineRemoved = await removeStorageObject(
        COVER_IMAGE_QUARANTINE_BUCKET,
        session.upload_path,
      );
      if (quarantineRemoved && await deleteUploadSession(session.id)) {
        cleanupCounts.consumedSessionsDeleted += 1;
      }
    }
  }

  const rateLimitBefore = new Date(Date.now() - RATE_LIMIT_RETENTION_MILLISECONDS).toISOString();
  const { count: staleRateLimitCount, error: rateLimitCleanupError } = await getSupabaseAdminClient()
    .from("commons_rate_limits")
    .delete({ count: "exact" })
    .lt("window_started_at", rateLimitBefore);
  if (rateLimitCleanupError) {
    console.error("Supabase rate limit cleanup failed", rateLimitCleanupError.message);
  } else {
    cleanupCounts.staleRateLimitsDeleted = staleRateLimitCount ?? 0;
  }

  return cleanupCounts;
}

export async function createSubmissionUploadSession(
  intent: SubmissionUploadIntent,
): Promise<SubmissionUploadGrant> {
  const id = randomUUID();
  const extension = MIME_TYPE_EXTENSIONS[intent.mimeType];
  const uploadPath = `${id}.${extension}`;
  const finalizeToken = randomBytes(32).toString("base64url");
  const { data: session, error: sessionError } = await getSupabaseAdminClient()
    .from("commons_upload_sessions")
    .insert({
      id,
      upload_path: uploadPath,
      finalize_token_hash: finalizeTokenHash(finalizeToken),
      original_name: intent.fileName,
      claimed_mime_type: intent.mimeType,
      claimed_size: intent.fileSize,
    })
    .select("expires_at")
    .single();
  if (sessionError) throw databaseError("upload session creation", sessionError.message);

  const { data: signedUpload, error: signedUploadError } = await getSupabaseAdminClient()
    .storage
    .from(COVER_IMAGE_QUARANTINE_BUCKET)
    .createSignedUploadUrl(uploadPath, { upsert: false });
  if (signedUploadError) {
    await deleteUploadSession(id);
    throw databaseError("signed upload creation", signedUploadError.message);
  }

  return {
    bucket: COVER_IMAGE_QUARANTINE_BUCKET,
    uploadId: id,
    uploadPath,
    uploadToken: signedUpload.token,
    finalizeToken,
    expiresAt: session.expires_at,
  };
}

export async function recoverFinalizedSubmissionReplay(
  input: SubmissionFinalize & { post: CommonsPost },
) {
  const { data, error } = await getSupabaseAdminClient()
    .rpc("recover_commons_submission_finalize_replay", {
      p_upload_id: input.uploadId,
      p_finalize_token_hash: finalizeTokenHash(input.finalizeToken),
      p_submission_id: input.submissionId,
      p_submitter_email: input.submitterEmail,
      p_event: input.event as unknown as Json,
      p_post: input.post as unknown as Json,
    })
    .maybeSingle();
  if (error) throw databaseError("finalized submission replay recovery", error.message);
  if (!data) return false;

  if (data.recovered) {
    await removeStorageObject(COVER_IMAGE_QUARANTINE_BUCKET, data.upload_path);
  }
  return true;
}

async function claimUploadSession(
  uploadId: string,
  tokenHash: string,
  submissionId: string,
): Promise<CommonsUploadSessionRow> {
  const now = new Date();
  const client = getSupabaseAdminClient();
  const { data: claimed, error: claimError } = await client
    .rpc("claim_commons_upload_session", {
      p_upload_id: uploadId,
      p_finalize_token_hash: tokenHash,
      p_submission_id: submissionId,
      p_processing_lease_seconds: PROCESSING_LEASE_MILLISECONDS / 1000,
    })
    .maybeSingle();
  if (claimError) throw databaseError("upload session claim", claimError.message);
  if (claimed) return claimed;

  const { data: session, error } = await client
    .from("commons_upload_sessions")
    .select("*")
    .eq("id", uploadId)
    .eq("finalize_token_hash", tokenHash)
    .maybeSingle();
  if (error) throw databaseError("upload session lookup", error.message);
  if (!session) {
    throw new UploadSessionError("The upload confirmation is invalid or expired.", "invalid");
  }
  if (session.requested_submission_id && session.requested_submission_id !== submissionId) {
    throw new UploadSessionError("That upload is already bound to another submission.", "conflict");
  }
  if (session.consumed_at) return session;
  if (new Date(session.expires_at).getTime() <= now.getTime()) {
    if (session.requested_submission_id === submissionId) return session;
    throw new UploadSessionError("The upload confirmation has expired.", "expired");
  }
  if (session.processing_at
    && new Date(session.processing_at).getTime() > now.getTime() - PROCESSING_LEASE_MILLISECONDS) {
    throw new UploadSessionError("That submission is already being processed.", "processing");
  }

  throw new UploadSessionError("That submission is already being processed.", "processing");
}

async function releaseUploadSession(session: CommonsUploadSessionRow) {
  const { error } = await getSupabaseAdminClient()
    .from("commons_upload_sessions")
    .update({ processing_at: null })
    .eq("id", session.id)
    .eq("finalize_token_hash", session.finalize_token_hash)
    .eq("requested_submission_id", session.requested_submission_id ?? "")
    .is("consumed_at", null);
  if (error) console.error("Supabase upload session release failed", error.message);
}

async function completeUploadSession(session: CommonsUploadSessionRow) {
  const { error } = await getSupabaseAdminClient()
    .from("commons_upload_sessions")
    .update({ consumed_at: new Date().toISOString(), processing_at: null })
    .eq("id", session.id)
    .eq("finalize_token_hash", session.finalize_token_hash)
    .eq("requested_submission_id", session.requested_submission_id ?? "")
    .is("consumed_at", null);
  if (error) console.error("Supabase upload session completion failed", error.message);
}

async function findSubmissionRow(id: string) {
  const { data, error } = await getSupabaseAdminClient()
    .from("commons_submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw databaseError("submission lookup", error.message);
  return data;
}

async function downloadQuarantinedImage(session: CommonsUploadSessionRow) {
  const { data, error } = await getSupabaseAdminClient()
    .storage
    .from(COVER_IMAGE_QUARANTINE_BUCKET)
    .download(session.upload_path);
  if (error) throw new UploadSessionError("Upload the cover image before submitting.", "invalid");
  if (data.size > MAX_COVER_IMAGE_SIZE_BYTES) {
    throw new CoverImageValidationError("The cover image must be 10 MB or smaller.");
  }
  if (data.size !== session.claimed_size) {
    throw new CoverImageValidationError("The uploaded image size does not match the selected file.");
  }
  return Buffer.from(await data.arrayBuffer());
}

async function uploadFinalCoverImage(path: string, bytes: Buffer) {
  const { error } = await getSupabaseAdminClient()
    .storage
    .from(FINAL_IMAGE_BUCKET)
    .upload(path, bytes, {
      cacheControl: "3600",
      contentType: "image/webp",
      upsert: true,
    });
  if (error) throw databaseError("final image upload", error.message);
}

export async function finalizeSubmission(
  input: SubmissionFinalize & { post: CommonsPost },
) {
  const tokenHash = finalizeTokenHash(input.finalizeToken);
  const session = await claimUploadSession(input.uploadId, tokenHash, input.submissionId);

  try {
    const existing = await findSubmissionRow(input.submissionId);
    if (existing) {
      if (existing.upload_session_id !== session.id) throw new SubmissionIdentityConflictError();
      if (!(await recoverFinalizedSubmissionReplay(input))) {
        throw new SubmissionReplayConflictError(input.submissionId);
      }
      return { created: false, submissionId: existing.id };
    }
    if (session.consumed_at) {
      throw new UploadSessionError("That upload has already been consumed.", "conflict");
    }
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      throw new UploadSessionError("The upload confirmation has expired.", "expired");
    }

    const sourceImage = await downloadQuarantinedImage(session);
    const preparedImage = await prepareCoverImage(
      sourceImage,
      session.claimed_mime_type as CoverImageMimeType,
    );
    const finalImagePath = `${session.id}.webp`;
    await uploadFinalCoverImage(finalImagePath, preparedImage.bytes);

    const { error } = await getSupabaseAdminClient()
      .from("commons_submissions")
      .insert({
        id: input.submissionId,
        badge_color: "#b9f543",
        cover_image_name: session.original_name,
        cover_image_path: finalImagePath,
        event: input.event as unknown as Json,
        post: input.post as unknown as Json,
        source: "form",
        status: "pending",
        submitter_email: input.submitterEmail,
        upload_session_id: session.id,
      });
    if (error) {
      if (error.code === "23505") {
        const racedSubmission = await findSubmissionRow(input.submissionId);
        if (racedSubmission?.upload_session_id === session.id) {
          await completeUploadSession(session);
          await removeStorageObject(COVER_IMAGE_QUARANTINE_BUCKET, session.upload_path);
          return { created: false, submissionId: racedSubmission.id };
        }
        await removeStorageObject(FINAL_IMAGE_BUCKET, finalImagePath);
        throw new SubmissionIdentityConflictError();
      }
      await removeStorageObject(FINAL_IMAGE_BUCKET, finalImagePath);
      throw databaseError("submission creation", error.message);
    }

    await completeUploadSession(session);
    await removeStorageObject(COVER_IMAGE_QUARANTINE_BUCKET, session.upload_path);
    return { created: true, submissionId: input.submissionId };
  } catch (error) {
    if (!session.consumed_at) await releaseUploadSession(session);
    throw error;
  }
}

export async function listSubmissions(
  query: SubmissionListQuery,
): Promise<SubmissionListResponse> {
  let request = getSupabaseAdminClient()
    .from("commons_submissions")
    .select("*")
    .order("submitted_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(query.limit + 1);
  if (query.status) request = request.eq("status", query.status);
  if (query.cursor) {
    request = request.or(
      `submitted_at.lt.${query.cursor.submittedAt},and(submitted_at.eq.${query.cursor.submittedAt},id.lt.${query.cursor.id})`,
    );
  }

  const { data, error } = await request;
  if (error) throw databaseError("submission listing", error.message);

  const pageRows = data.slice(0, query.limit);
  const submissions = await toSubmissions(pageRows);
  return {
    submissions,
    nextCursor: data.length > query.limit && submissions.length > 0
      ? createSubmissionCursor(submissions[submissions.length - 1])
      : null,
  };
}

export async function getSubmissionById(id: string) {
  const row = await findSubmissionRow(id);
  if (!row) return null;
  return (await toSubmissions([row]))[0];
}

export type UpdateSubmissionResult =
  | { outcome: "updated"; submission: CommonsSubmission }
  | { outcome: "not-found" }
  | { outcome: "version-conflict"; submission: CommonsSubmission };

export async function updateSubmission(
  id: string,
  update: SubmissionUpdate,
  reviewerId: string,
): Promise<UpdateSubmissionResult> {
  const values: Database["public"]["Tables"]["commons_submissions"]["Update"] = update.type === "edit"
    ? {
        badge_color: update.badgeColor,
        event: update.event as unknown as Json,
        post: update.post as unknown as Json,
        updated_by: reviewerId,
      }
    : {
        reviewed_at: update.status === "pending" ? null : new Date().toISOString(),
        reviewed_by: update.status === "pending" ? null : reviewerId,
        status: update.status,
        updated_by: reviewerId,
      };
  const { data, error } = await getSupabaseAdminClient()
    .from("commons_submissions")
    .update(values)
    .eq("id", id)
    .eq("version", update.version)
    .select("*")
    .maybeSingle();
  if (error) throw databaseError("submission update", error.message);
  if (data) {
    return {
      outcome: "updated",
      submission: (await toSubmissions([data]))[0],
    };
  }

  const existing = await findSubmissionRow(id);
  return existing
    ? {
        outcome: "version-conflict",
        submission: (await toSubmissions([existing]))[0],
      }
    : { outcome: "not-found" };
}
