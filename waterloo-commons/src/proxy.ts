import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";

function copyCookies(source: NextResponse, destination: NextResponse) {
  source.cookies.getAll().forEach((cookie) => destination.cookies.set(cookie));
  return destination;
}

function redirectWithCookies(request: NextRequest, response: NextResponse, destination: string) {
  return copyCookies(response, NextResponse.redirect(new URL(destination, request.url)));
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) {
    return new NextResponse("Authentication is temporarily unavailable.", { status: 503 });
  }

  let response = NextResponse.next({ request });
  const authClient = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await authClient.auth.getUser();
  if (!data.user?.email) {
    return redirectWithCookies(request, response, "/auth/login");
  }

  const adminClient = createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: curator, error } = await adminClient
    .from("commons_curators")
    .select("email")
    .eq("email", data.user.email.trim().toLowerCase())
    .maybeSingle();

  if (error) {
    return copyCookies(
      response,
      new NextResponse("Curator access could not be verified.", { status: 503 }),
    );
  }
  if (!curator) {
    await authClient.auth.signOut({ scope: "local" });
    return redirectWithCookies(request, response, "/auth/login?error=not-authorized");
  }

  return response;
}

export const config = {
  matcher: ["/feed", "/admin/review", "/admin/studio"],
};
