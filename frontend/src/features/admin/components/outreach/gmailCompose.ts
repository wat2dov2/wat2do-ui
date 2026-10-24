import outreach from "../../../../../../backend/controlbox/outreach.json" with { type: "json" };

/** A Gmail compose window in the outreach account, filled in and left for the admin to send. */
export function gmailComposeUrl({ to, subject, body }: { to: string; subject: string; body: string }) {
  const params = new URLSearchParams({ view: "cm", fs: "1", authuser: outreach.gmail_account, to, su: subject, body });
  return `https://mail.google.com/mail/?${params}`;
}
