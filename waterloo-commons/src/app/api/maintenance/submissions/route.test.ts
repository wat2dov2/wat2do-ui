import { afterEach, describe, expect, it, vi } from "vitest";

const { cleanupSubmissionEphemeralState } = vi.hoisted(() => ({
  cleanupSubmissionEphemeralState: vi.fn(),
}));

vi.mock("@/lib/submission-repository", () => ({
  cleanupSubmissionEphemeralState,
}));

import { GET } from "@/app/api/maintenance/submissions/route";

describe("submission maintenance route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    cleanupSubmissionEphemeralState.mockReset();
  });

  it("rejects requests without the cron bearer secret", async () => {
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    const response = await GET(new Request("https://commons.example/api/maintenance/submissions"));

    expect(response.status).toBe(401);
    expect(cleanupSubmissionEphemeralState).not.toHaveBeenCalled();
  });

  it("runs bounded cleanup for an authorized cron request", async () => {
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    cleanupSubmissionEphemeralState.mockResolvedValue({
      expiredUploadsProcessed: 2,
      consumedSessionsDeleted: 3,
      staleRateLimitsDeleted: 4,
    });
    const response = await GET(new Request(
      "https://commons.example/api/maintenance/submissions",
      { headers: { Authorization: "Bearer cron-test-secret" } },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      cleanup: {
        expiredUploadsProcessed: 2,
        consumedSessionsDeleted: 3,
        staleRateLimitsDeleted: 4,
      },
    });
    expect(cleanupSubmissionEphemeralState).toHaveBeenCalledWith(100);
  });
});
