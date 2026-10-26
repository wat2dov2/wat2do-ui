/**
 * A Gmail compose window in the admin's signed-in account, filled in and left for them to send.
 * Values are percent-encoded (spaces as %20, not form-style "+") so the draft reads exactly as written.
 */
export function gmailComposeUrl({ to, subject, body }: { to: string; subject: string; body: string }) {
  const params = Object.entries({ view: "cm", fs: "1", to, su: subject, body })
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `https://mail.google.com/mail/?${params}`;
}
