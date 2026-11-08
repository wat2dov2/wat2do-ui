# Club tickets

Clubs give out tickets to their events on wat2do.
A ticket is one admission to one date of an event, with a QR code that holds the link to its page.
The club scans it at the door with the scanner in its club panel, or with any phone camera.

An event's tickets come in tiers ("General admission", "Members", "Early bird"), each with its own name, price and, optionally, its own limit, under one limit for the whole event that counts every tier and date together.
A club sets them up in one form (`/club-panel/events/<event_id>/settings`): the limit, then each tier.
A tier priced at zero is free, and free and paid tiers work the same way at the door.
Free tiers need nothing set up: anyone signed in takes a free tier's ticket in a tap, one per person and date.
Paid tickets are sold through the club's own Stripe account (a Connect Standard account the club owns and signs in to at dashboard.stripe.com): every ticket is a direct charge on that account, so the money never passes through wat2do.
Stripe pays the club, charges its fees to the club, and takes refunds and disputes from the club's balance.
wat2do takes no fee and pays no Connect fees.

## How it fits together

- `rust/src/api/tickets` is the whole feature, and `rust/src/api/tickets/stripe.rs` is the only code that calls Stripe.
  Every Stripe call that touches money names the club's connected account, and every write carries an idempotency key.
- The routes are `/events/{event_id}/ticketing` (an event's tickets, the desk, the door and refunds), `/tickets` (tickets as their holders see them), `/clubs/{club_id}/payouts` and `/clubs/{club_id}/ticket-sales`, and `POST /webhooks/stripe`.
- `backend/database/migrations/20261106010000_club_tickets.sql` holds the tables: `event_ticketing` (the event's limit and pausing), `ticket_orders` (one Stripe Checkout each), `tickets` and `club_payment_accounts`; `20261108120000_ticket_tiers.sql` adds `ticket_tiers` (a price of zero is free), which every ticket and order belongs to.
- Every change to an event's tickets locks the event's row, then its `event_ticketing` row, the order an event's edit takes them too, so two people can never both take the last seat and a cancellation is seen by every change after it.
- A paid checkout holds its seats in Postgres while the buyer is on Stripe Checkout, and becomes tickets exactly once however often Stripe repeats its webhook.
- Taking or buying a ticket marks the holder going, so reminders and change alerts reach them; ticket holders count toward Going but are never named on the public list.
- Setting tickets up with one free tier hands a ticket, by email, to everyone already going to the event's upcoming dates, so a limit below the people already going is refused.
- A limit never drops below the tickets already taken, and a tier people hold tickets of can't be removed or change its price.
- A free ticket's holder can give it back until the date ends; a paid ticket's holder asks the club for a refund instead, and everyone on the club's team gets an email.
- Cancelling an event refunds every paid ticket in the background; the club's desk can finish any refund Stripe could not make at the time.
  An order paid after the cancellation is refunded when its webhook arrives, and Stripe repeats that webhook until the refund goes through.
  An event people paid for can't be deleted, only cancelled, and a date with paid tickets can't be removed.
- Only the club's current team (or an admin) edits, cancels or deletes an event with tickets, whoever first created it.
- A club with a Stripe account or ticket orders can't be deleted, and neither can a person who bought tickets or is paying for some now.
- The Instagram ingestion agent cannot change an event with tickets or its dates: a database trigger skips its writes.
- A paid Checkout whose order is gone is only logged (`names unknown order`): that takes a webhook delayed past the order's hold while someone removed its date, event or buyer, so refund it on the club's account by hand.
- `backend/controlbox/ticketing.json` holds the limits and `paid_tickets_enabled`, which ships off.

## Running the door

- A club's desk for one event is `/club-panel/events/<event_id>`: its ticket settings at a glance, counts, the door list and refunds; Set up tickets and Edit tickets open the settings form.
  The event's page shows the club's team a Tickets button that opens it, and so does the screen after a club publishes an event.
- The door scanner is `/club-panel/events/<event_id>/scan`.
  It starts the camera when it opens, buzzes once for a good ticket and three times for anything to look at, and takes typed codes when a phone won't scan.
- A ticket's QR code opens `/tickets/<code>`; someone on the club's team who opens it sees a Check in button.
- Scanning a ticket twice says when it was first checked in rather than admitting it twice.
- The door admits a ticket only to its own date: from `check_in_opens_hours_before` the date starts until `check_in_closes_hours_after` it ends, and when two dates are open, the closer one.
  A ticket to another date says so instead of checking in.

## Costs of paid tickets

Stripe keeps about 2.9% + 30¢ of each card payment, charged to the club's own account.
Standard accounts cost the platform nothing: the club pays Stripe's fees and carries refunds and disputes itself.

## Test mode

Never use live keys outside production.
The test-mode platform account and its Connect webhook (to `https://wat2do.io/api/webhooks/stripe`) exist already; their keys are in the Mac's Keychain under `wat2do-stripe-test`.

1. Put the test secret key in `backend/.env` as `STRIPE_SECRET_KEY=sk_test_...` and the webhook's signing secret as `STRIPE_WEBHOOK_SECRET=whsec_...`.
2. Set `"paid_tickets_enabled": true` in `backend/controlbox/ticketing.json` for the local run only.
3. With the Stripe CLI, `stripe listen --forward-connect-to localhost:8000/webhooks/stripe` forwards Connect events to a local API and prints a temporary signing secret to use instead.

A Connect webhook must listen to "Events on Connected accounts" with these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `account.updated`.

## Turning paid tickets on in production

1. Finish the Stripe platform's live activation and Connect profile (business details, branding) in the Stripe Dashboard.
2. Create the live Connect webhook for `https://wat2do.io/api/webhooks/stripe` with the events above.
3. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (live) to the Mac's `~/wat2do-data/config/backend.env`, then restart the API (`launchctl kickstart -k gui/$(id -u)/io.wat2do.api`).
4. Set `"paid_tickets_enabled": true` in `backend/controlbox/ticketing.json` and deploy.
   `GET /clubs/<club_id>/payouts` then reports `paid_tickets_enabled: true`, and clubs see Payouts in their club panel.
5. Sell one real ticket to a test event, refund it from the desk, and confirm both emails arrived.

Paid tickets stay off until every step is done: without both keys the API refuses paid tickets even with the switch on.
