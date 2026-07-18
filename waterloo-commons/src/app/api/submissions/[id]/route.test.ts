import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSubmissionById: vi.fn(),
  updateSubmission: vi.fn(),
  verifyCuratorAccess: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/curator-auth", () => ({
  curatorAccessErrorResponse: (access: { error: string; status: number }) => (
    Response.json({ error: access.error }, { status: access.status })
  ),
  verifyCuratorAccess: mocks.verifyCuratorAccess,
}));
vi.mock("@/lib/submission-repository", () => ({
  getSubmissionById: mocks.getSubmissionById,
  updateSubmission: mocks.updateSubmission,
}));

import { GET, PATCH } from "@/app/api/submissions/[id]/route";
import { DEFAULT_POST } from "@/lib/post";
import type { CommonsSubmission } from "@/lib/submissions";

const submissionId = "b0483b56-5fd4-4fbd-a163-fa32d1c31a2b";
const curatorId = "cc680344-8f95-476b-80f9-65bf2b171d5b";
const submission: CommonsSubmission = {
  id: submissionId,
  source: "form",
  status: "pending",
  submittedAt: "2026-07-15T14:00:00.000Z",
  updatedAt: "2026-07-15T14:05:00.000Z",
  updatedBy: curatorId,
  version: 2,
  reviewedAt: null,
  submitterEmail: "event@example.com",
  event: {
    title: "Canvas Designathon",
    hosts: "UW Blueprint",
    date: "Sun, Nov 16",
    time: "9:00 AM - 6:30 PM",
    location: "Accelerator Centre",
    description: "Build for a cause.",
    registrationUrl: "https://example.com/register",
  },
  coverImageUrl: "https://storage.example/signed-cover.webp",
  coverImageName: "cover.png",
  badgeColor: "#b9f543",
  post: DEFAULT_POST,
};

function routeContext(id = submissionId) {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: object) {
  return new Request(`https://commons.example/api/submissions/${submissionId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://commons.example",
    },
    body: JSON.stringify(body),
  });
}

describe("submission detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyCuratorAccess.mockResolvedValue({
      ok: true,
      curator: { email: "curator@example.com", userId: curatorId },
    });
    mocks.getSubmissionById.mockResolvedValue(submission);
  });

  it("returns a curator-only submission detail", async () => {
    const response = await GET(
      new Request(`https://commons.example/api/submissions/${submissionId}`),
      routeContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ submission });
    expect(mocks.getSubmissionById).toHaveBeenCalledWith(submissionId);
  });

  it("returns the latest record in a 409 optimistic-concurrency conflict", async () => {
    mocks.updateSubmission.mockResolvedValue({
      outcome: "version-conflict",
      submission,
    });
    const response = await PATCH(
      patchRequest({ type: "review", version: 1, status: "approved" }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "version-conflict",
      error: "This event changed after you opened it. Review the latest version and try again.",
      submission,
    });
    expect(mocks.updateSubmission).toHaveBeenCalledWith(
      submissionId,
      { type: "review", version: 1, status: "approved" },
      curatorId,
    );
  });

  it("requires curator access before reading or mutating a submission", async () => {
    mocks.verifyCuratorAccess.mockResolvedValue({
      ok: false,
      error: "Sign in as a curator to continue.",
      status: 401,
    });

    const getResponse = await GET(
      new Request(`https://commons.example/api/submissions/${submissionId}`),
      routeContext(),
    );
    const patchResponse = await PATCH(
      patchRequest({ type: "review", version: 2, status: "approved" }),
      routeContext(),
    );

    expect(getResponse.status).toBe(401);
    expect(patchResponse.status).toBe(401);
    expect(mocks.getSubmissionById).not.toHaveBeenCalled();
    expect(mocks.updateSubmission).not.toHaveBeenCalled();
  });
});
