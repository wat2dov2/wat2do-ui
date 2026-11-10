import { expect, test } from "@playwright/test";
import {
  configureEventTicketing,
  requestTicketRefund,
  setTicketCheckIn,
  startTicketCheckout,
  takeFreeTicket,
} from "../src/features/tickets/api/tickets.api";
import {
  formatTicketCode,
  refundRequestState,
  ticketCodeFrom,
} from "../src/features/tickets/lib/ticketFormat";
import { api } from "../src/shared/services/apiClient";
import { formatCents } from "../src/shared/utils/currency";

const CODE = "7KQ2MZ4PABCDEFGHIJKLMNOP";

test.describe("reading a ticket at the door", () => {
  test("a scanned link and a typed code both read as the stored code", () => {
    for (const scanned of [
      `https://uwaterloo.wat2do.io/tickets/${CODE}`,
      `https://uwaterloo.wat2do.io/tickets/${CODE}/`,
      `https://uwaterloo.wat2do.io/tickets/${CODE}?refund=1`,
      " 7kq2 mz4p abcd efgh ijkl mnop ",
      "7KQ2-MZ4P-ABCD-EFGH-IJKL-MNOP",
    ]) {
      expect(ticketCodeFrom(scanned), scanned).toBe(CODE);
    }
  });

  test("codes read in groups of four", () => {
    expect(formatTicketCode(CODE)).toBe("7KQ2 MZ4P ABCD EFGH IJKL MNOP");
  });
});

test("a refund request is waiting, declined, or nothing to wait on", () => {
  const ticket = { status: "valid", refund_requested_at: null, refund_declined_at: null } as const;
  expect(refundRequestState(ticket)).toBe("none");
  expect(refundRequestState({ ...ticket, refund_requested_at: "2026-11-02T12:00:00Z" })).toBe(
    "waiting",
  );
  expect(
    refundRequestState({
      ...ticket,
      refund_requested_at: "2026-11-02T12:00:00Z",
      refund_declined_at: "2026-11-03T12:00:00Z",
    }),
  ).toBe("declined");
  expect(
    refundRequestState({
      status: "refunded",
      refund_requested_at: "2026-11-02T12:00:00Z",
      refund_declined_at: null,
    }),
  ).toBe("none");
});

test("money reads in the ticket's own currency", () => {
  expect(formatCents(1500, "cad", "en-CA")).toBe("$15.00");
  expect(formatCents(1500, "usd", "en-US")).toBe("$15.00");
  expect(formatCents(1500, "usd", "en-CA")).toBe("US$15.00");
});

test.describe("what the ticket requests send", () => {
  type Sent = { method: string; path: string; data: unknown };
  let sent: Sent[] = [];
  const original = { post: api.post, put: api.put };

  test.beforeEach(() => {
    sent = [];
    api.post = async <T>(path: string, data?: unknown) => {
      sent.push({ method: "POST", path, data });
      return {} as T;
    };
    api.put = async <T>(path: string, data?: unknown) => {
      sent.push({ method: "PUT", path, data });
      return {} as T;
    };
  });

  test.afterEach(() => {
    api.post = original.post;
    api.put = original.put;
  });

  test("taking a free ticket names its date and tier", async () => {
    await takeFreeTicket(42, { eventDateId: "date-1", tierId: "tier-1" });
    expect(sent).toEqual([
      {
        method: "POST",
        path: "/events/42/ticketing/tickets",
        data: { event_date_id: "date-1", tier_id: "tier-1" },
      },
    ]);
  });

  test("a checkout names its date, its tier and how many tickets", async () => {
    await startTicketCheckout(42, { eventDateId: "date-1", tierId: "tier-2", quantity: 3 });
    expect(sent[0]).toEqual({
      method: "POST",
      path: "/events/42/ticketing/checkout",
      data: { event_date_id: "date-1", tier_id: "tier-2", quantity: 3 },
    });
  });

  test("settings send the event's limit, pausing and every tier", async () => {
    const settings = {
      capacity: 120,
      paused: false,
      tiers: [
        { id: null, name: "Members", price_cents: 0, capacity: 40 },
        { id: "tier-1", name: "General admission", price_cents: 1500, capacity: null },
      ],
    };
    await configureEventTicketing(42, settings);
    expect(sent[0]).toEqual({ method: "PUT", path: "/events/42/ticketing", data: settings });
  });

  test("a scanned link is sent as its code, safely in the path", async () => {
    await setTicketCheckIn(42, CODE, true);
    await requestTicketRefund(CODE, null);
    expect(sent).toEqual([
      {
        method: "PUT",
        path: `/events/42/ticketing/check-ins/${CODE}`,
        data: { checked_in: true },
      },
      { method: "POST", path: `/tickets/${CODE}/refund-request`, data: { note: null } },
    ]);
  });
});
