import { NextResponse } from "next/server";
import { requireSameOrigin, SafeRequestError, withTimeout } from "@/lib/request-security";
import { createSupabaseAuthClient } from "@/lib/supabase/server";

const SIGN_OUT_TIMEOUT_MS = 5_000;

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
  } catch (error) {
    const message = error instanceof SafeRequestError ? error.message : "Request could not be verified.";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  const authClient = await createSupabaseAuthClient();
  try {
    const { error } = await withTimeout(authClient.auth.signOut({ scope: "local" }), SIGN_OUT_TIMEOUT_MS);
    if (error) throw error;
  } catch {
    console.error("Curator sign-out failed.");
    return NextResponse.json(
      { error: "Sign-out is temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }

  return NextResponse.redirect(new URL("/auth/login", request.url), 303);
}
