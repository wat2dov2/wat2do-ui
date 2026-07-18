import { NextResponse } from "next/server";
import { consumeRateLimit, requestRateLimitKey } from "@/lib/abuse-protection";
import { createSubmissionPost } from "@/lib/create-submission-post";
import { curatorAccessErrorResponse, verifyCuratorAccess } from "@/lib/curator-auth";
import type { CommonsPost } from "@/lib/post";
import {
  CoverImageValidationError,
  finalizeSubmission,
  listSubmissions,
  recoverFinalizedSubmissionReplay,
  SubmissionIdentityConflictError,
  SubmissionReplayConflictError,
  UploadSessionError,
} from "@/lib/submission-repository";
import {
  parseSubmissionFinalize,
  parseSubmissionListQuery,
  type SubmissionAlreadyFinalizedResponse,
  type SubmissionFinalizeResponse,
} from "@/lib/submissions";
import { readJsonWithLimit, requireSameOrigin, SafeRequestError } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SUBMISSION_FINALIZE_BODY_BYTES = 16 * 1024;
const SUBMISSION_FINALIZE_LIMIT = 10;
const SUBMISSION_FINALIZE_WINDOW_SECONDS = 60 * 60;

function noStore<T extends Response>(response: T) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function json(body: object, init?: ResponseInit) {
  return noStore(NextResponse.json(body, init));
}

export async function GET(request: Request) {
  try {
    const access = await verifyCuratorAccess();
    if (!access.ok) return noStore(curatorAccessErrorResponse(access));

    let query;
    try {
      query = parseSubmissionListQuery(new URL(request.url).searchParams);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "The submission query is invalid." },
        { status: 400 },
      );
    }

    return json(await listSubmissions(query));
  } catch (error) {
    console.error("Commons submission listing failed", error);
    return json({ error: "Events could not be loaded right now." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const body = await readJsonWithLimit<unknown>(request, MAX_SUBMISSION_FINALIZE_BODY_BYTES);
    let submission;
    try {
      submission = parseSubmissionFinalize(body);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "The submission is invalid." },
        { status: 400 },
      );
    }
    let post: CommonsPost;
    try {
      post = createSubmissionPost(submission.event);
    } catch {
      return json(
        { error: "The event details are too long to create its Instagram caption." },
        { status: 400 },
      );
    }

    if (await recoverFinalizedSubmissionReplay({ ...submission, post })) {
      const response: SubmissionFinalizeResponse = {
        ok: true,
        submissionId: submission.submissionId,
      };
      return json(response, { status: 200 });
    }

    const rateLimit = await consumeRateLimit({
      bucket: "submission-finalize",
      keyHash: requestRateLimitKey(request, submission.submitterEmail),
      limit: SUBMISSION_FINALIZE_LIMIT,
      windowSeconds: SUBMISSION_FINALIZE_WINDOW_SECONDS,
    });
    if (!rateLimit.allowed) {
      return json(
        { error: "Too many submissions. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const result = await finalizeSubmission({
      ...submission,
      post,
    });
    const response: SubmissionFinalizeResponse = {
      ok: true,
      submissionId: result.submissionId,
    };
    return json(response, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof SafeRequestError) {
      return json({ error: error.message }, { status: error.status });
    }
    if (error instanceof CoverImageValidationError) {
      return json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SubmissionIdentityConflictError) {
      return json({ error: error.message }, { status: 409 });
    }
    if (error instanceof SubmissionReplayConflictError) {
      const response: SubmissionAlreadyFinalizedResponse = {
        code: "submission-already-finalized",
        error: error.message,
        submissionId: error.submissionId,
      };
      return json(response, { status: 409 });
    }
    if (error instanceof UploadSessionError) {
      const status = error.code === "expired" ? 410 : error.code === "invalid" ? 400 : 409;
      return json(
        { error: error.message },
        status === 409 && error.code === "processing"
          ? { status, headers: { "Retry-After": "5" } }
          : { status },
      );
    }

    console.error("Commons submission finalization failed", error);
    return json(
      { error: "The event could not be submitted right now." },
      { status: 503 },
    );
  }
}
