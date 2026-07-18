import { NextResponse } from "next/server";
import { consumeRateLimit, requestRateLimitKey } from "@/lib/abuse-protection";
import {
  cleanupSubmissionEphemeralState,
  createSubmissionUploadSession,
} from "@/lib/submission-repository";
import { parseSubmissionUploadIntent, type SubmissionUploadResponse } from "@/lib/submissions";
import { readJsonWithLimit, requireSameOrigin, SafeRequestError } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_INTENT_BODY_BYTES = 4 * 1024;
const UPLOAD_INTENT_LIMIT = 10;
const UPLOAD_INTENT_WINDOW_SECONDS = 60 * 60;

function json(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const body = await readJsonWithLimit<unknown>(request, MAX_UPLOAD_INTENT_BODY_BYTES);
    let intent;
    try {
      intent = parseSubmissionUploadIntent(body);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "The upload details are invalid." },
        { status: 400 },
      );
    }

    const rateLimit = await consumeRateLimit({
      bucket: "submission-upload-intent",
      keyHash: requestRateLimitKey(request),
      limit: UPLOAD_INTENT_LIMIT,
      windowSeconds: UPLOAD_INTENT_WINDOW_SECONDS,
    });
    if (!rateLimit.allowed) {
      return json(
        { error: "Too many upload attempts. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    await cleanupSubmissionEphemeralState();
    const response: SubmissionUploadResponse = {
      upload: await createSubmissionUploadSession(intent),
    };
    return json(response, { status: 201 });
  } catch (error) {
    if (error instanceof SafeRequestError) {
      return json({ error: error.message }, { status: error.status });
    }
    console.error("Commons upload intent failed", error);
    return json(
      { error: "The image upload could not be started right now." },
      { status: 503 },
    );
  }
}
