import { NextResponse } from "next/server";
import { isCuratorEmail } from "@/lib/curator-auth";
import { createSupabaseAuthClient } from "@/lib/supabase/server";

const ALLOWED_DESTINATIONS = new Set(["/feed", "/admin/review", "/admin/studio"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const destination = ALLOWED_DESTINATIONS.has(url.searchParams.get("next") ?? "")
    ? url.searchParams.get("next") as string
    : "/feed";

  if (!code) return NextResponse.redirect(new URL("/auth/login?error=auth-failed", url));

  const authClient = await createSupabaseAuthClient();
  const { error } = await authClient.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/auth/login?error=auth-failed", url));

  const { data } = await authClient.auth.getUser();
  const email = data.user?.email;
  if (!email || !(await isCuratorEmail(email))) {
    await authClient.auth.signOut();
    return NextResponse.redirect(new URL("/auth/login?error=not-authorized", url));
  }

  return NextResponse.redirect(new URL(destination, url));
}
