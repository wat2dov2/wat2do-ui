import { createHash } from "node:crypto";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { createSubmissionPost } from "@/lib/create-submission-post";
import {
  finalizeSubmission,
  prepareCoverImage,
  recoverFinalizedSubmissionReplay,
  SubmissionReplayConflictError,
} from "@/lib/submission-repository";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import {
  COVER_IMAGE_QUARANTINE_BUCKET,
  MAX_COVER_IMAGE_SIZE_BYTES,
} from "@/lib/submissions";

beforeEach(() => {
  vi.mocked(getSupabaseAdminClient).mockReset();
});

describe("cover image preparation", () => {
  it("normalizes accepted raster input to a bounded WebP", async () => {
    const input = await sharp({
      create: {
        width: 3000,
        height: 1000,
        channels: 3,
        background: { r: 40, g: 120, b: 200 },
      },
    }).png().toBuffer();

    const prepared = await prepareCoverImage(input, "image/png");
    const metadata = await sharp(prepared.bytes).metadata();
    expect(prepared.contentType).toBe("image/webp");
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(2160);
    expect(metadata.height).toBe(720);
  });

  it("rejects spoofed MIME types and unsupported formats", async () => {
    const jpeg = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 240, g: 200, b: 80 },
      },
    }).jpeg().toBuffer();
    await expect(prepareCoverImage(jpeg, "image/png")).rejects.toThrow(
      "contents do not match its file type",
    );

    const gif = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    }).gif().toBuffer();
    await expect(prepareCoverImage(gif, "image/webp")).rejects.toThrow(
      "Upload a PNG, JPEG, or WebP image",
    );
  });

  it("rejects a compressed body above the public 10 MB contract", async () => {
    await expect(prepareCoverImage(
      Buffer.alloc(MAX_COVER_IMAGE_SIZE_BYTES + 1),
      "image/webp",
    )).rejects.toThrow("10 MB or smaller");
  });
});

describe("finalized submission replay recovery", () => {
  const event = {
    title: "Canvas Designathon",
    hosts: "UW Blueprint",
    date: "Sun, Nov 16",
    time: "9:00 AM - 6:30 PM",
    location: "Accelerator Centre",
    description: "Build for a cause.",
    registrationUrl: "https://example.com/register",
  };
  const input = {
    submissionId: "b0483b56-5fd4-4fbd-a163-fa32d1c31a2b",
    uploadId: "cc680344-8f95-476b-80f9-65bf2b171d5b",
    finalizeToken: "f".repeat(43),
    submitterEmail: "event@example.com",
    event,
    post: createSubmissionPost(event),
  };

  it("authenticates the exact replay and cleans an interrupted quarantine once", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { upload_path: `${input.uploadId}.png`, recovered: true },
      error: null,
    });
    const rpc = vi.fn(() => ({ maybeSingle }));
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const from = vi.fn(() => ({ remove }));
    vi.mocked(getSupabaseAdminClient).mockReturnValue({
      rpc,
      storage: { from },
    } as never);

    await expect(recoverFinalizedSubmissionReplay(input)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("recover_commons_submission_finalize_replay", {
      p_upload_id: input.uploadId,
      p_finalize_token_hash: createHash("sha256").update(input.finalizeToken).digest("hex"),
      p_submission_id: input.submissionId,
      p_submitter_email: input.submitterEmail,
      p_event: input.event,
      p_post: input.post,
    });
    expect(from).toHaveBeenCalledWith(COVER_IMAGE_QUARANTINE_BUCKET);
    expect(remove).toHaveBeenCalledWith([`${input.uploadId}.png`]);
  });

  it("does not touch Storage when the replay credentials do not match", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const rpc = vi.fn(() => ({ maybeSingle }));
    const from = vi.fn();
    vi.mocked(getSupabaseAdminClient).mockReturnValue({
      rpc,
      storage: { from },
    } as never);

    await expect(recoverFinalizedSubmissionReplay(input)).resolves.toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects changed data when the same upload session already committed", async () => {
    const claimMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const replayMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const rpc = vi.fn((name: string) => ({
      maybeSingle: name === "claim_commons_upload_session"
        ? claimMaybeSingle
        : replayMaybeSingle,
    }));
    const uploadSession = {
      id: input.uploadId,
      upload_path: `${input.uploadId}.png`,
      finalize_token_hash: createHash("sha256").update(input.finalizeToken).digest("hex"),
      original_name: "event.png",
      claimed_mime_type: "image/png",
      claimed_size: 1024,
      created_at: "2026-07-15T14:00:00.000Z",
      expires_at: "2026-07-15T14:15:00.000Z",
      processing_at: null,
      consumed_at: "2026-07-15T14:05:00.000Z",
      requested_submission_id: input.submissionId,
    };
    const submissionRow = { upload_session_id: input.uploadId };
    const query = (data: object) => {
      const builder = {
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
        select: vi.fn(),
      };
      builder.eq.mockReturnValue(builder);
      builder.select.mockReturnValue(builder);
      return builder;
    };
    const from = vi.fn((table: string) => (
      table === "commons_upload_sessions" ? query(uploadSession) : query(submissionRow)
    ));
    vi.mocked(getSupabaseAdminClient).mockReturnValue({ rpc, from } as never);

    const changedInput = { ...input, submitterEmail: "changed@example.com" };
    const result = finalizeSubmission(changedInput);
    await expect(result).rejects.toMatchObject({
      name: "SubmissionReplayConflictError",
      submissionId: input.submissionId,
    });
    await expect(result).rejects.toBeInstanceOf(
      SubmissionReplayConflictError,
    );
    expect(rpc).toHaveBeenCalledWith(
      "recover_commons_submission_finalize_replay",
      expect.objectContaining({
        p_post: input.post,
        p_submitter_email: "changed@example.com",
      }),
    );
  });
});
