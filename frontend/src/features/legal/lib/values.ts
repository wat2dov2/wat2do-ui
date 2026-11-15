import authentication from "../../../../../backend/controlbox/authentication.json" with { type: "json" };
import clubPayouts from "../../../../../backend/controlbox/club_payouts.json" with { type: "json" };
import legal from "../../../../../backend/controlbox/legal.json" with { type: "json" };
import notificationInbox from "../../../../../backend/controlbox/notification_inbox.json" with { type: "json" };
import ticketing from "../../../../../backend/controlbox/ticketing.json" with { type: "json" };
import { formatCalendarDate, formatDuration, formatList } from "@/features/legal/lib/format";
import { formatCents } from "@/shared/utils/currency";
import { formatDayOfMonth } from "@/shared/utils/date";

/** What a document's copy fills in; `email` and `effectiveDate` appear in every one. */
export type LegalValues = { email: string; effectiveDate: string } & Record<string, string>;

/** The payout terms' numbers, from the control boxes, written out in `language`. */
export function clubPayoutTermsValues(language: string, schoolNames: string[]): LegalValues {
  const money = (cents: number) => formatCents(cents, clubPayouts.currency, language);
  const days = (count: number) => formatDuration(count, "day", language);
  const hours = (count: number) => formatDuration(count, "hour", language);
  return {
    email: legal.contact_email,
    effectiveDate: formatCalendarDate(clubPayouts.terms_effective_date, language),
    schools: formatList(schoolNames, language),
    rate: money(clubPayouts.rate_cents),
    maxPerEventDate: money(clubPayouts.rate_cents * clubPayouts.max_paid_scans_per_event_date),
    monthlyCap: money(clubPayouts.max_payout_cents_per_club_per_month),
    liabilityFloor: money(clubPayouts.liability_floor_cents),
    payoutDay: formatDayOfMonth(clubPayouts.payout_day_of_month, language),
    deadlineDays: days(clubPayouts.payout_details_deadline_days),
    disputeDays: days(clubPayouts.dispute_window_days),
    replyDays: days(clubPayouts.dispute_reply_days),
    proofDays: days(clubPayouts.proof_response_days),
    holdDays: days(clubPayouts.review_hold_days),
    clawbackDays: days(clubPayouts.clawback_days),
    noticeDays: days(clubPayouts.change_notice_days),
    opensHours: hours(ticketing.check_in_opens_hours_before),
    closesHours: hours(ticketing.check_in_closes_hours_after),
  };
}

/** The payout schools' slugs, for the page to name. */
export const CLUB_PAYOUT_SCHOOLS: readonly string[] = clubPayouts.schools;

/** The data policy's contact, date, sign-in timings and inbox retention, written out in `language`. */
export function dataPolicyValues(language: string): LegalValues {
  return {
    email: legal.contact_email,
    effectiveDate: formatCalendarDate(legal.data_policy_effective_date, language),
    sessionDays: formatDuration(authentication.session_cookie_days, "day", language),
    codeMinutes: formatDuration(authentication.verification_token_minutes, "minute", language),
    inboxDays: formatDuration(notificationInbox.retention_days, "day", language),
  };
}
