import Link from "next/link";
import { CuratorLoginForm } from "@/components/curator-login-form";
import { SiteHeader } from "@/components/site-header";

const LOGIN_ERRORS: Record<string, string> = {
  "auth-failed": "That sign-in link is invalid or expired. Request a new one.",
  "not-authorized": "This email is not on the Waterloo Commons curator list.",
};

export default async function CuratorLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="site-page">
      <SiteHeader audience="public" />
      <section className="curator-login-page">
        <div>
          <p className="eyebrow">WATERLOO COMMONS CURATORS</p>
          <h1>Open the review desk.</h1>
          <p>Use an approved curator email. Supabase will send a secure, passwordless sign-in link.</p>
        </div>
        <div className="curator-login-card">
          <CuratorLoginForm initialError={error ? LOGIN_ERRORS[error] ?? LOGIN_ERRORS["auth-failed"] : ""} />
          <Link href="/">Back to event submission</Link>
        </div>
      </section>
    </main>
  );
}
