import { expect, test } from "@playwright/test";
import { gmailComposeUrl } from "../src/features/admin/components/outreach/gmailCompose";

test("opens a filled-in draft in the signed-in Gmail account", () => {
  const url = new URL(gmailComposeUrl({
    to: "events@club.ca",
    subject: "Your gala & Wat2Do",
    body: "Hi team,\n\nC++ night? 100% yes: https://uwaterloo.wat2do.io/events/submit?x=1\n\nTony",
  }));

  expect(`${url.origin}${url.pathname}`).toBe("https://mail.google.com/mail/");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    view: "cm",
    fs: "1",
    to: "events@club.ca",
    su: "Your gala & Wat2Do",
    body: "Hi team,\n\nC++ night? 100% yes: https://uwaterloo.wat2do.io/events/submit?x=1\n\nTony",
  });
  expect(url.search).not.toContain("+");
});
