import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cleanupSubmissionEphemeralState } from "@/lib/submission-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function authorized(request: Request, secret: string) {
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length
    && timingSafeEqual(suppliedBytes, expectedBytes);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("Commons maintenance is missing CRON_SECRET.");
    return json({ error: "Maintenance is not configured." }, { status: 503 });
  }
  if (!authorized(request, secret)) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    return json({ ok: true, cleanup: await cleanupSubmissionEphemeralState(100) });
  } catch (error) {
    console.error("Commons submission maintenance failed", error);
    return json({ error: "Maintenance failed." }, { status: 503 });
  }
}
