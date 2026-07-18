import "server-only";

import { createHmac } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

function abuseProtectionSecret() {
  const configured = process.env.REQUEST_FINGERPRINT_SECRET;
  const localFallback = process.env.NODE_ENV === "production"
    ? undefined
    : process.env.SUPABASE_SECRET_KEY;
  const secret = configured || localFallback;
  if (!secret) throw new Error("REQUEST_FINGERPRINT_SECRET is not configured.");
  return secret;
}

export function requestClientAddress(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
  return forwarded.split(",", 1)[0].trim().toLowerCase().slice(0, 128) || "unknown";
}

export function hashAbuseProtectionKey(parts: readonly string[]) {
  const normalized = parts.map((part) => part.trim().toLowerCase());
  return createHmac("sha256", abuseProtectionSecret())
    .update(JSON.stringify(normalized))
    .digest("hex");
}

export function requestRateLimitKey(request: Request, ...identifiers: string[]) {
  return hashAbuseProtectionKey([requestClientAddress(request), ...identifiers]);
}

export async function consumeRateLimit({
  bucket,
  keyHash,
  limit,
  windowSeconds,
}: {
  bucket: string;
  keyHash: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitDecision> {
  const { data, error } = await getSupabaseAdminClient()
    .rpc("consume_commons_rate_limit", {
      p_bucket: bucket,
      p_key_hash: keyHash,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })
    .single();

  if (error || !data) {
    throw new Error(`Supabase rate limit failed: ${error?.message ?? "No decision returned."}`);
  }

  return {
    allowed: data.allowed,
    retryAfterSeconds: data.retry_after_seconds,
  };
}
