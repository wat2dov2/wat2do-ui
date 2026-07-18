import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanupSubmissionEphemeralState: vi.fn(),
  consumeRateLimit: vi.fn(),
  createSubmissionUploadSession: vi.fn(),
  requestRateLimitKey: vi.fn(() => "a".repeat(64)),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/abuse-protection", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  requestRateLimitKey: mocks.requestRateLimitKey,
}));
vi.mock("@/lib/submission-repository", () => ({
  cleanupSubmissionEphemeralState: mocks.cleanupSubmissionEphemeralState,
  createSubmissionUploadSession: mocks.createSubmissionUploadSession,
}));
import { POST } from "@/app/api/submission-uploads/route";

const uploadGrant = {
  bucket: "commons-event-image-quarantine" as const,
  uploadId: "b0483b56-5fd4-4fbd-a163-fa32d1c31a2b",
  uploadPath: "b0483b56-5fd4-4fbd-a163-fa32d1c31a2b.png",
  uploadToken: "signed-upload-token",
  finalizeToken: "f".repeat(43),
  expiresAt: "2026-07-15T16:00:00.000Z",
};

function uploadRequest(origin = "https://commons.example") {
  return new Request("https://commons.example/api/submission-uploads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify({
      fileName: "event.png",
      fileSize: 1024,
      mimeType: "image/png",
    }),
  });
}

describe("submission upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.cleanupSubmissionEphemeralState.mockResolvedValue({
      expiredUploadsProcessed: 0,
      consumedSessionsDeleted: 0,
      staleRateLimitsDeleted: 0,
    });
    mocks.createSubmissionUploadSession.mockResolvedValue(uploadGrant);
  });

  it("issues a private signed upload grant after durable rate limiting", async () => {
    const response = await POST(uploadRequest());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ upload: uploadGrant });
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith({
      bucket: "submission-upload-intent",
      keyHash: "a".repeat(64),
      limit: 10,
      windowSeconds: 3600,
    });
    expect(mocks.cleanupSubmissionEphemeralState).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin requests before consuming abuse-control capacity", async () => {
    const response = await POST(uploadRequest("https://attacker.example"));

    expect(response.status).toBe(403);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("returns a retry window after the durable limit is reached", async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });
    const response = await POST(uploadRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("90");
    expect(mocks.createSubmissionUploadSession).not.toHaveBeenCalled();
  });
});
