import { NextResponse } from "next/server";
import { curatorAccessErrorResponse, verifyCuratorAccess } from "@/lib/curator-auth";
import { getSubmissionById, updateSubmission } from "@/lib/submission-repository";
import { parseSubmissionId, parseSubmissionUpdate } from "@/lib/submissions";
import { readJsonWithLimit, requireSameOrigin, SafeRequestError } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SUBMISSION_UPDATE_BODY_BYTES = 16 * 1024;

function noStore<T extends Response>(response: T) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function json(body: object, init?: ResponseInit) {
  return noStore(NextResponse.json(body, init));
}

function invalidIdResponse(error: unknown) {
  return json(
    { error: error instanceof Error ? error.message : "Submission ID is invalid." },
    { status: 400 },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await verifyCuratorAccess();
    if (!access.ok) return noStore(curatorAccessErrorResponse(access));

    let id: string;
    try {
      id = parseSubmissionId((await params).id);
    } catch (error) {
      return invalidIdResponse(error);
    }

    const submission = await getSubmissionById(id);
    if (!submission) return json({ error: "Submission not found." }, { status: 404 });
    return json({ submission });
  } catch (error) {
    console.error("Commons submission lookup failed", error);
    return json({ error: "The event could not be loaded right now." }, { status: 503 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const access = await verifyCuratorAccess();
    if (!access.ok) return noStore(curatorAccessErrorResponse(access));

    let id: string;
    try {
      id = parseSubmissionId((await params).id);
    } catch (error) {
      return invalidIdResponse(error);
    }

    const body = await readJsonWithLimit<unknown>(request, MAX_SUBMISSION_UPDATE_BODY_BYTES);
    let update;
    try {
      update = parseSubmissionUpdate(body);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "The submission update is invalid." },
        { status: 400 },
      );
    }

    const result = await updateSubmission(id, update, access.curator.userId);
    if (result.outcome === "not-found") {
      return json({ error: "Submission not found." }, { status: 404 });
    }
    if (result.outcome === "version-conflict") {
      return json(
        {
          code: "version-conflict",
          error: "This event changed after you opened it. Review the latest version and try again.",
          submission: result.submission,
        },
        { status: 409 },
      );
    }

    return json({ submission: result.submission });
  } catch (error) {
    if (error instanceof SafeRequestError) {
      return json({ error: error.message }, { status: error.status });
    }
    console.error("Commons submission update failed", error);
    return json({ error: "The event could not be updated right now." }, { status: 503 });
  }
}
