"use client";

import { type FormEvent, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function CuratorLoginForm({ initialError = "" }: { initialError?: string }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(initialError);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSending(true);
    setMessage("");

    try {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("next", "/feed");
      const { error } = await getSupabaseBrowserClient().auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: callbackUrl.toString(),
          shouldCreateUser: true,
        },
      });
      if (error) throw error;

      setSent(true);
      setMessage("Check your email for the secure curator sign-in link.");
    } catch {
      setMessage("The sign-in link could not be sent. Confirm the address and try again.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <form className="curator-login-form" onSubmit={handleSubmit}>
      <label htmlFor="curator-email">Curator email</label>
      <input
        id="curator-email"
        name="email"
        type="email"
        autoComplete="email"
        maxLength={254}
        required
        value={email}
        disabled={sent}
        onChange={(event) => setEmail(event.target.value)}
      />
      {message && <p className={sent ? "login-message is-success" : "login-message"} role="status">{message}</p>}
      {!sent && (
        <button className="primary-button" type="submit" disabled={isSending}>
          {isSending ? "SENDING..." : "EMAIL SIGN-IN LINK"}
        </button>
      )}
    </form>
  );
}
