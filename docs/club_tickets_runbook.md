# Club tickets

Clubs give out tickets to their events on wat2do.
A ticket is one admission to one date of an event, with a QR code that holds the link to its page.
The club scans it at the door with the scanner in its club panel, or with any phone camera.

Tickets are free or paid, and both work the same way at the door.
Free tickets need nothing set up: a club turns them on for an event, and anyone signed in takes one in a tap.
Paid tickets are sold through the club's own Stripe Connect Express account: every ticket is a direct charge on that account, so the money never passes through wat2do.
Stripe pays the club, takes its fee from the club's payout, and takes refunds from the club's balance.
wat2do takes no fee.

## How it fits together

- `rust/src/api/tickets` is the whole feature, and `rust/src/api/tickets/stripe.rs` is the only code that calls Stripe.
  Every Stripe call that touches money names the club's connected account, and every write carries an idempotency key.
- The routes are `/events/{event_id}/ticketing` (an event's tickets, the desk, the door and refunds), `/tickets` (tickets as their holders see them), `/clubs/{club_id}/payouts` and `/clubs/{club_id}/ticket-sales`, and `POST /webhooks/stripe`.
- `backend/database/migrations/20261106010000_club_tickets.sql` holds the tables: `event_ticketing` (a price of zero is free), `ticket_orders` (one Stripe Checkout each), `tickets` and `club_payment_accounts`.
- Every change to an event's tickets locks its `event_ticketing` row first, so two people can never both take the last seat.
- A paid checkout holds its seats in Postgres while the buyer is on Stripe Checkout, and becomes tickets exactly once however often Stripe repeats its webhook.
- Taking or buying a ticket marks the holder going, so reminders and change alerts reach them; ticket holders count toward Going but are never named on the public list.
- Turning free tickets on hands a ticket, by email, to everyone already going to the event's upcoming dates.
- A free ticket's holder can give it back until the date ends; a paid ticket's holder asks the club for a refund instead, and everyone on the club's team gets an email.
- Cancelling an event refunds every paid ticket in the background; the club's desk can finish any refund Stripe could not make at the time.
  An event people paid for can't be deleted, only cancelled, and a date with paid tickets can't be removed.
- The Instagram ingestion agent cannot change an event with tickets or its dates: a database trigger skips its writes.
- `backend/controlbox/ticketing.json` holds the limits and `paid_tickets_enabled`, which ships off.

## Running the door

- A club's desk for one event is `/club-panel/events/<event_id>`: turning tickets on, counts, the door list and refunds.
  The event's page shows the club's team a Tickets button that opens it, and so does the screen after a club publishes an event.
- The door scanner is `/club-panel/events/<event_id>/scan`.
  It starts the camera when it opens, buzzes once for a good ticket and three times for anything to look at, and takes typed codes when a phone won't scan.
- A ticket's QR code opens `/tickets/<code>`; someone on the club's team who opens it sees a Check in button.
- Scanning a ticket twice says when it was first checked in rather than admitting it twice.

## Costs of paid tickets

Stripe keeps about 2.9% + 30¢ of each card payment, deducted from the club's payout.
Express accounts also cost the platform about $2 a month for each club that receives a payout that month, plus about 0.25% + 25¢ per payout.
wat2do pays those Connect fees.

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
