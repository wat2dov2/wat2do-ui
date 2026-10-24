import { expect, test } from "@playwright/test";
import {
  formatDay,
  formatTicketCode,
  refundRequestState,
  ticketCodeFrom,
} from "../src/features/tickets/lib/ticketFormat";
import { formatCents } from "../src/shared/utils/currency";

test("a scanned ticket link and a hand-typed code read as the same code", () => {
  const code = "7KQ2MZ4PABCDEFGHIJKLMNOP";
  expect(ticketCodeFrom(`https://uwaterloo.wat2do.io/tickets/${code}`)).toBe(code);
  expect(ticketCodeFrom(`https://uwaterloo.wat2do.io/tickets/${code}/`)).toBe(code);
  expect(ticketCodeFrom("7kq2 mz4p-abcd")).toBe("7KQ2MZ4PABCD");
});

test("codes are grouped in fours so they can be read aloud at a door", () => {
  expect(formatTicketCode("7KQ2MZ4PABCD")).toBe("7KQ2 MZ4P ABCD");
});

test("ticket prices show in the event's own currency", () => {
  expect(formatCents(1500, "cad", "en-CA")).toBe("$15.00");
  expect(formatCents(1500, "usd", "en-US")).toBe("$15.00");
  expect(formatCents(1500, "cad", "en-US")).toBe("CA$15.00");
});

test("a refund request waits on the club until it refunds or declines", () => {
  const asked = "2026-11-01T12:00:00Z";
  expect(refundRequestState({ status: "valid", refund_requested_at: null })).toBe("none");
  expect(refundRequestState({ status: "valid", refund_requested_at: asked })).toBe("waiting");
  expect(
    refundRequestState({ status: "valid", refund_requested_at: asked, refund_declined_at: asked }),
  ).toBe("declined");
  // Refunding answers the request, so a refunded ticket has nothing left to wait on.
  expect(refundRequestState({ status: "refunded", refund_requested_at: asked })).toBe("none");
});

test("request dates read as a short day in the reader's language", () => {
  expect(formatDay("2026-11-01T12:00:00Z", "en-US")).toBe("Nov 1");
  expect(formatDay(null, "en-US")).toBe("");
});
