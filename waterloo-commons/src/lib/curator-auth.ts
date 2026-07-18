import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseAuthClient, getSupabaseAdminClient } from "@/lib/supabase/server";

export interface CuratorIdentity {
  email: string;
  userId: string;
}

export type CuratorAccess =
  | { ok: true; curator: CuratorIdentity }
  | { ok: false; error: string; status: 401 | 403 };

export async function isCuratorEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await getSupabaseAdminClient()
    .from("commons_curators")
    .select("email")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error) throw new Error(`Curator access could not be checked: ${error.message}`);
  return Boolean(data);
}

export async function verifyCuratorAccess(): Promise<CuratorAccess> {
  const authClient = await createSupabaseAuthClient();
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) {
    return { ok: false, error: "Sign in as a curator to continue.", status: 401 };
  }

  const email = data.user.email?.trim().toLowerCase();
  if (!email || !(await isCuratorEmail(email))) {
    return { ok: false, error: "This account is not a Waterloo Commons curator.", status: 403 };
  }

  return {
    ok: true,
    curator: {
      email,
      userId: data.user.id,
    },
  };
}

export function curatorAccessErrorResponse(access: Extract<CuratorAccess, { ok: false }>) {
  return NextResponse.json({ error: access.error }, { status: access.status });
}
