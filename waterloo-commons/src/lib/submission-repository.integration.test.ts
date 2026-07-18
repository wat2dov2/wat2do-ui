import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSubmissionPost } from "@/lib/create-submission-post";
import {
  cleanupSubmissionEphemeralState,
  createSubmissionUploadSession,
  finalizeSubmission,
  getSubmissionById,
  listSubmissions,
  recoverFinalizedSubmissionReplay,
  SubmissionReplayConflictError,
  updateSubmission,
} from "@/lib/submission-repository";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import {
  COVER_IMAGE_QUARANTINE_BUCKET,
  parseSubmissionCursor,
  type EventSubmissionFields,
} from "@/lib/submissions";

const describeIntegration = process.env.RUN_SUPABASE_INTEGRATION === "1" ? describe : describe.skip;

describeIntegration("submission repository integration", () => {
  const submissionId = randomUUID();
  const rateLimitKey = randomUUID().replaceAll("-", "").padEnd(64, "0");
  const retainedImageSessionId = randomUUID();
  const signedUploadGraceSessionId = randomUUID();
  const staleRateLimitKey = randomUUID().replaceAll("-", "").padEnd(64, "0");
  let uploadId = "";
  const event: EventSubmissionFields = {
    title: "Repository Integration Event",
    hosts: "Waterloo Commons",
    date: "Fri, July 17",
    time: "6:00 PM",
    location: "Waterloo",
    description: "A local integration test event.",
    registrationUrl: "https://example.com/register",
  };

  beforeAll(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      throw new Error("Local Supabase environment variables are required for integration tests.");
    }
  });

  afterAll(async () => {
    const client = getSupabaseAdminClient();
    if (uploadId) {
      await client.from("commons_submissions").delete().eq("id", submissionId);
      await client.storage.from("commons-event-images").remove([`${uploadId}.webp`]);
      await client.from("commons_upload_sessions").delete().eq("id", uploadId);
    }
    await client.from("commons_rate_limits").delete().eq("key_hash", rateLimitKey);
    await client.storage.from("commons-event-images").remove([`${retainedImageSessionId}.webp`]);
    await client.storage.from(COVER_IMAGE_QUARANTINE_BUCKET).remove([
      `${retainedImageSessionId}.webp`,
      `${signedUploadGraceSessionId}.webp`,
    ]);
    await client.from("commons_upload_sessions").delete().eq("id", retainedImageSessionId);
    await client.from("commons_upload_sessions").delete().eq("id", signedUploadGraceSessionId);
    await client.from("commons_rate_limits").delete().eq("key_hash", staleRateLimitKey);
  });

  it("finalizes a signed upload exactly once and stores only normalized WebP", async () => {
    const sourceImage = await sharp({
      create: {
        width: 240,
        height: 160,
        channels: 3,
        background: { r: 90, g: 160, b: 70 },
      },
    }).png().toBuffer();
    const grant = await createSubmissionUploadSession({
      fileName: "integration-cover.png",
      fileSize: sourceImage.byteLength,
      mimeType: "image/png",
    });
    uploadId = grant.uploadId;

    const { error: uploadError } = await getSupabaseAdminClient()
      .storage
      .from(COVER_IMAGE_QUARANTINE_BUCKET)
      .uploadToSignedUrl(grant.uploadPath, grant.uploadToken, sourceImage, {
        contentType: "image/png",
      });
    expect(uploadError).toBeNull();

    const input = {
      submissionId,
      uploadId: grant.uploadId,
      finalizeToken: grant.finalizeToken,
      submitterEmail: "integration@example.com",
      event,
      post: createSubmissionPost(event),
    };
    await expect(finalizeSubmission(input)).resolves.toEqual({
      created: true,
      submissionId,
    });
    await expect(recoverFinalizedSubmissionReplay({
      ...input,
      finalizeToken: "x".repeat(43),
    })).resolves.toBe(false);
    await expect(recoverFinalizedSubmissionReplay({
      ...input,
      event: { ...event, description: "This is not an exact replay." },
    })).resolves.toBe(false);

    const { error: interruptedCompletionError } = await getSupabaseAdminClient()
      .from("commons_upload_sessions")
      .update({ consumed_at: null, processing_at: new Date().toISOString() })
      .eq("id", uploadId);
    expect(interruptedCompletionError).toBeNull();
    const { error: orphanedQuarantineError } = await getSupabaseAdminClient()
      .storage
      .from(COVER_IMAGE_QUARANTINE_BUCKET)
      .upload(grant.uploadPath, sourceImage, { contentType: "image/png" });
    expect(orphanedQuarantineError).toBeNull();
    await expect(recoverFinalizedSubmissionReplay(input)).resolves.toBe(true);
    const { data: recoveredSession, error: recoveredSessionError } = await getSupabaseAdminClient()
      .from("commons_upload_sessions")
      .select("consumed_at, processing_at")
      .eq("id", uploadId)
      .single();
    expect(recoveredSessionError).toBeNull();
    if (!recoveredSession) throw new Error("Recovered upload session was not returned.");
    expect(recoveredSession.consumed_at).not.toBeNull();
    expect(recoveredSession.processing_at).toBeNull();
    await expect(recoverFinalizedSubmissionReplay(input)).resolves.toBe(true);
    await expect(finalizeSubmission({
      ...input,
      submitterEmail: "changed@example.com",
    })).rejects.toBeInstanceOf(SubmissionReplayConflictError);
    await expect(finalizeSubmission({
      ...input,
      event: { ...input.event, description: "Changed after the committed finalize." },
    })).rejects.toBeInstanceOf(SubmissionReplayConflictError);
    await expect(finalizeSubmission({
      ...input,
      post: { ...input.post, caption: `${input.post.caption}\nChanged.` },
    })).rejects.toBeInstanceOf(SubmissionReplayConflictError);

    await expect(finalizeSubmission(input)).resolves.toEqual({
      created: false,
      submissionId,
    });

    const expiredAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { error: ageError } = await getSupabaseAdminClient()
      .from("commons_upload_sessions")
      .update({
        consumed_at: null,
        created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        expires_at: expiredAt,
        processing_at: null,
      })
      .eq("id", uploadId);
    expect(ageError).toBeNull();
    await expect(finalizeSubmission(input)).resolves.toEqual({
      created: false,
      submissionId,
    });

    const stored = await getSubmissionById(submissionId);
    expect(stored).toMatchObject({
      id: submissionId,
      coverImageName: "integration-cover.png",
      status: "pending",
      version: 1,
    });
    expect(stored?.coverImageUrl).toContain(`${uploadId}.webp`);

    const { data: quarantined } = await getSupabaseAdminClient()
      .storage
      .from(COVER_IMAGE_QUARANTINE_BUCKET)
      .list("", { search: grant.uploadPath });
    expect(quarantined).toEqual([]);
  });

  it("allows only one concurrent request through an atomic one-request bucket", async () => {
    const decisions = await Promise.all(Array.from({ length: 5 }, async () => {
      const { data, error } = await getSupabaseAdminClient().rpc("consume_commons_rate_limit", {
        p_bucket: "integration-test",
        p_key_hash: rateLimitKey,
        p_limit: 1,
        p_window_seconds: 3600,
      });
      expect(error).toBeNull();
      if (!data) throw new Error("Rate limit decision was not returned.");
      return data[0].allowed;
    }));

    expect(decisions.filter(Boolean)).toHaveLength(1);
  });

  it("increments versions and rejects a stale curator edit", async () => {
    const post = createSubmissionPost(event);
    const updated = await updateSubmission(submissionId, {
      type: "edit",
      version: 1,
      event: { ...event, description: "Updated by the integration test." },
      post,
      badgeColor: "#ff5a36",
    }, null as never);
    expect(updated.outcome).toBe("updated");
    if (updated.outcome !== "updated") throw new Error("Submission was not updated.");
    expect(updated.submission).toMatchObject({
      version: 2,
      updatedBy: null,
      badgeColor: "#ff5a36",
    });

    const stale = await updateSubmission(submissionId, {
      type: "review",
      version: 1,
      status: "approved",
    }, null as never);
    expect(stale.outcome).toBe("version-conflict");
    if (stale.outcome !== "version-conflict") throw new Error("Stale update was not rejected.");
    expect(stale.submission.version).toBe(2);
  });

  it("uses a stable cursor without repeating rows", async () => {
    const firstPage = await listSubmissions({ limit: 1 });
    expect(firstPage.submissions).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listSubmissions({
      limit: 1,
      cursor: parseSubmissionCursor(firstPage.nextCursor ?? ""),
    });
    expect(secondPage.submissions).toHaveLength(1);
    expect(secondPage.submissions[0].id).not.toBe(firstPage.submissions[0].id);
  });

  it("bounds stale durable state without deleting finalized image objects", async () => {
    const client = getSupabaseAdminClient();
    const staleTimestamp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const finalizedImage = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 30, g: 60, b: 90 },
      },
    }).webp().toBuffer();
    const { error: imageError } = await client.storage
      .from("commons-event-images")
      .upload(`${retainedImageSessionId}.webp`, finalizedImage, { contentType: "image/webp" });
    expect(imageError).toBeNull();
    const { error: quarantineImageError } = await client.storage
      .from(COVER_IMAGE_QUARANTINE_BUCKET)
      .upload(`${retainedImageSessionId}.webp`, finalizedImage, { contentType: "image/webp" });
    expect(quarantineImageError).toBeNull();

    const { error: sessionError } = await client.from("commons_upload_sessions").insert({
      id: retainedImageSessionId,
      upload_path: `${retainedImageSessionId}.webp`,
      finalize_token_hash: "c".repeat(64),
      original_name: "retained.webp",
      claimed_mime_type: "image/webp",
      claimed_size: finalizedImage.byteLength,
      created_at: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      consumed_at: staleTimestamp,
      requested_submission_id: randomUUID(),
    });
    expect(sessionError).toBeNull();
    const { error: graceImageError } = await client.storage
      .from(COVER_IMAGE_QUARANTINE_BUCKET)
      .upload(`${signedUploadGraceSessionId}.webp`, finalizedImage, { contentType: "image/webp" });
    expect(graceImageError).toBeNull();
    const { error: graceSessionError } = await client.from("commons_upload_sessions").insert({
      id: signedUploadGraceSessionId,
      upload_path: `${signedUploadGraceSessionId}.webp`,
      finalize_token_hash: "d".repeat(64),
      original_name: "still-signed.webp",
      claimed_mime_type: "image/webp",
      claimed_size: finalizedImage.byteLength,
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });
    expect(graceSessionError).toBeNull();
    const { error: liveSessionAgeError } = await client
      .from("commons_upload_sessions")
      .update({ consumed_at: staleTimestamp })
      .eq("id", uploadId);
    expect(liveSessionAgeError).toBeNull();
    const { error: rateError } = await client.from("commons_rate_limits").insert({
      bucket: "integration-stale",
      key_hash: staleRateLimitKey,
      request_count: 1,
      window_started_at: staleTimestamp,
    });
    expect(rateError).toBeNull();

    const cleanup = await cleanupSubmissionEphemeralState();
    expect(cleanup.consumedSessionsDeleted).toBeGreaterThanOrEqual(2);
    expect(cleanup.staleRateLimitsDeleted).toBeGreaterThanOrEqual(1);
    const { data: retainedImage, error: retainedImageError } = await client.storage
      .from("commons-event-images")
      .download(`${retainedImageSessionId}.webp`);
    expect(retainedImageError).toBeNull();
    expect(retainedImage?.size).toBeGreaterThan(0);
    const { error: removedQuarantineError } = await client.storage
      .from(COVER_IMAGE_QUARANTINE_BUCKET)
      .download(`${retainedImageSessionId}.webp`);
    expect(removedQuarantineError).not.toBeNull();

    const { data: graceSession, error: graceSessionLookupError } = await client
      .from("commons_upload_sessions")
      .select("id")
      .eq("id", signedUploadGraceSessionId)
      .maybeSingle();
    expect(graceSessionLookupError).toBeNull();
    expect(graceSession?.id).toBe(signedUploadGraceSessionId);
    const { data: graceImage, error: graceImageDownloadError } = await client.storage
      .from(COVER_IMAGE_QUARANTINE_BUCKET)
      .download(`${signedUploadGraceSessionId}.webp`);
    expect(graceImageDownloadError).toBeNull();
    expect(graceImage?.size).toBeGreaterThan(0);

    const liveSubmission = await getSubmissionById(submissionId);
    expect(liveSubmission).toMatchObject({
      id: submissionId,
      version: 2,
    });
    expect(liveSubmission?.coverImageUrl).toContain(`${uploadId}.webp`);
  });
});
