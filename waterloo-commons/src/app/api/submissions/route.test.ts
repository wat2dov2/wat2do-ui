import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class CoverImageValidationError extends Error {}
  class SubmissionIdentityConflictError extends Error {}
  class SubmissionReplayConflictError extends Error {
    constructor(readonly submissionId: string) {
      super("That upload was already finalized with different submission details.");
    }
  }
  class UploadSessionError extends Error {
    constructor(message: string, readonly code: string) {
      super(message);
    }
  }

  return {
    CoverImageValidationError,
    SubmissionIdentityConflictError,
    SubmissionReplayConflictError,
    UploadSessionError,
    consumeRateLimit: vi.fn(),
    finalizeSubmission: vi.fn(),
    listSubmissions: vi.fn(),
    recoverFinalizedSubmissionReplay: vi.fn(),
    requestRateLimitKey: vi.fn(() => "a".repeat(64)),
    verifyCuratorAccess: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/abuse-protection", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  requestRateLimitKey: mocks.requestRateLimitKey,
}));
vi.mock("@/lib/curator-auth", () => ({
  curatorAccessErrorResponse: (access: { error: string; status: number }) => (
    Response.json({ error: access.error }, { status: access.status })
  ),
  verifyCuratorAccess: mocks.verifyCuratorAccess,
}));
vi.mock("@/lib/submission-repository", () => ({
  CoverImageValidationError: mocks.CoverImageValidationError,
  SubmissionIdentityConflictError: mocks.SubmissionIdentityConflictError,
  SubmissionReplayConflictError: mocks.SubmissionReplayConflictError,
  UploadSessionError: mocks.UploadSessionError,
  finalizeSubmission: mocks.finalizeSubmission,
  listSubmissions: mocks.listSubmissions,
  recoverFinalizedSubmissionReplay: mocks.recoverFinalizedSubmissionReplay,
}));

import { GET, POST } from "@/app/api/submissions/route";

const submissionId = "b0483b56-5fd4-4fbd-a163-fa32d1c31a2b";
const uploadId = "cc680344-8f95-476b-80f9-65bf2b171d5b";
const event = {
  title: "Canvas Designathon",
  hosts: "UW Blueprint",
  date: "Sun, Nov 16",
  time: "9:00 AM - 6:30 PM",
  location: "Accelerator Centre",
  description: "Build for a cause.",
  registrationUrl: "https://example.com/register",
};

function submissionRequest(eventFields = event) {
  return new Request("https://commons.example/api/submissions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://commons.example",
    },
    body: JSON.stringify({
      submissionId,
      uploadId,
      finalizeToken: "f".repeat(43),
      submitterEmail: " EVENT@Example.com ",
      event: eventFields,
    }),
  });
}

describe("submissions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.finalizeSubmission.mockResolvedValue({ created: true, submissionId });
    mocks.listSubmissions.mockResolvedValue({ submissions: [], nextCursor: null });
    mocks.recoverFinalizedSubmissionReplay.mockResolvedValue(false);
    mocks.verifyCuratorAccess.mockResolvedValue({
      ok: true,
      curator: { email: "curator@example.com", userId: submissionId },
    });
  });

  it("finalizes a normalized submission with its generated post", async () => {
    const response = await POST(submissionRequest());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true, submissionId });
    expect(mocks.finalizeSubmission).toHaveBeenCalledWith(expect.objectContaining({
      submissionId,
      uploadId,
      submitterEmail: "event@example.com",
      event,
      post: expect.objectContaining({
        badge: "EVENT",
        hostOrg: "UW Blueprint",
      }),
    }));
  });

  it("returns a client error when valid event fields cannot fit the generated caption", async () => {
    const response = await POST(submissionRequest({
      title: "T".repeat(70),
      hosts: "H".repeat(80),
      date: "D".repeat(40),
      time: "T".repeat(40),
      location: "L".repeat(80),
      description: "X".repeat(400),
      registrationUrl: `https://example.com/${"r".repeat(2000)}`,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The event details are too long to create its Instagram caption.",
    });
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.finalizeSubmission).not.toHaveBeenCalled();
  });

  it("returns the durable retry window without touching the upload session", async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });
    const response = await POST(submissionRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(mocks.finalizeSubmission).not.toHaveBeenCalled();
  });

  it("returns an authenticated committed replay before an exhausted finalize limit", async () => {
    mocks.recoverFinalizedSubmissionReplay.mockResolvedValue(true);
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });
    const response = await POST(submissionRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, submissionId });
    expect(mocks.recoverFinalizedSubmissionReplay).toHaveBeenCalledWith(expect.objectContaining({
      submissionId,
      uploadId,
      submitterEmail: "event@example.com",
      event,
      post: expect.objectContaining({ badge: "EVENT", hostOrg: "UW Blueprint" }),
    }));
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.finalizeSubmission).not.toHaveBeenCalled();
  });

  it.each([
    {
      error: new mocks.CoverImageValidationError("The image contents do not match its file type."),
      status: 400,
      retryAfter: null,
    },
    {
      error: new mocks.SubmissionIdentityConflictError("That submission identifier is already in use."),
      status: 409,
      retryAfter: null,
    },
    {
      error: new mocks.UploadSessionError("The upload confirmation has expired.", "expired"),
      status: 410,
      retryAfter: null,
    },
    {
      error: new mocks.UploadSessionError("That submission is already being processed.", "processing"),
      status: 409,
      retryAfter: "5",
    },
  ])("maps finalize failures to status $status", async ({ error, status, retryAfter }) => {
    mocks.finalizeSubmission.mockRejectedValue(error);
    const response = await POST(submissionRequest());

    expect(response.status).toBe(status);
    expect(response.headers.get("Retry-After")).toBe(retryAfter);
    await expect(response.json()).resolves.toEqual({ error: error.message });
  });

  it("returns a structured 409 when a committed upload is retried with changed data", async () => {
    const error = new mocks.SubmissionReplayConflictError(submissionId);
    mocks.finalizeSubmission.mockRejectedValue(error);
    const response = await POST(submissionRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "submission-already-finalized",
      error: error.message,
      submissionId,
    });
  });

  it("requires curator access before listing a bounded page", async () => {
    const response = await GET(new Request(
      "https://commons.example/api/submissions?status=pending&limit=12",
    ));

    expect(response.status).toBe(200);
    expect(mocks.listSubmissions).toHaveBeenCalledWith({
      status: "pending",
      cursor: undefined,
      limit: 12,
    });

    mocks.verifyCuratorAccess.mockResolvedValue({
      ok: false,
      error: "Sign in as a curator to continue.",
      status: 401,
    });
    const unauthorized = await GET(new Request("https://commons.example/api/submissions"));
    expect(unauthorized.status).toBe(401);
    expect(mocks.listSubmissions).toHaveBeenCalledOnce();
  });
});
