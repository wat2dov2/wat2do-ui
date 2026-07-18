import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const single = vi.fn();
const rpc = vi.fn(() => ({ single }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: () => ({ rpc }),
}));

import {
  consumeRateLimit,
  hashAbuseProtectionKey,
  requestClientAddress,
  requestRateLimitKey,
} from "@/lib/abuse-protection";

describe("abuse protection", () => {
  beforeEach(() => {
    vi.stubEnv("REQUEST_FINGERPRINT_SECRET", "test-fingerprint-secret");
    rpc.mockClear();
    single.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the platform client address and hashes raw identifiers", () => {
    const request = new Request("https://commons.example/api/submissions", {
      headers: {
        "x-forwarded-for": "198.51.100.4, 10.0.0.1",
        "x-vercel-forwarded-for": "203.0.113.8",
      },
    });

    expect(requestClientAddress(request)).toBe("203.0.113.8");
    const key = requestRateLimitKey(request, " PERSON@Example.com ");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).toBe(hashAbuseProtectionKey(["203.0.113.8", "person@example.com"]));
    expect(key).not.toContain("203.0.113.8");
  });

  it("maps the atomic database rate-limit decision", async () => {
    single.mockResolvedValue({
      data: { allowed: false, retry_after_seconds: 42 },
      error: null,
    });

    await expect(consumeRateLimit({
      bucket: "submission-finalize",
      keyHash: "a".repeat(64),
      limit: 10,
      windowSeconds: 3600,
    })).resolves.toEqual({ allowed: false, retryAfterSeconds: 42 });
    expect(rpc).toHaveBeenCalledWith("consume_commons_rate_limit", {
      p_bucket: "submission-finalize",
      p_key_hash: "a".repeat(64),
      p_limit: 10,
      p_window_seconds: 3600,
    });
  });

  it("fails closed when the durable limiter is unavailable", async () => {
    single.mockResolvedValue({ data: null, error: { message: "database unavailable" } });

    await expect(consumeRateLimit({
      bucket: "submission-upload-intent",
      keyHash: "b".repeat(64),
      limit: 10,
      windowSeconds: 3600,
    })).rejects.toThrow("Supabase rate limit failed");
  });
});
