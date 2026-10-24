# Club ticketing with Stripe Connect

Clubs sell tickets to their events on Wat2Do.
Each club connects its own Stripe Express account, and every ticket is a direct charge on that account.
The money never passes through Wat2Do: Stripe pays the club, takes its processing fee from the club's payout, and takes refunds from the club's balance.
Wat2Do takes no fee.

## How it fits together

- `backend/services/stripe_gateway.py` is the only code that calls Stripe, and every call names the club's connected account.
- `backend/services/club_payouts_service.py` creates a club's Express account the first time an officer starts onboarding, and never replaces it.
- `backend/services/ticketing_service.py` holds seats in Postgres while a buyer is on Stripe Checkout, issues tickets exactly once when Stripe reports the payment, refunds, and checks tickets in at the door.
- `POST /webhooks/stripe` receives Connect events and trusts them only with a valid Stripe signature.
- `backend/controlbox/ticketing.json` holds the limits and the on/off switch; it ships with `enabled: false`.
- Buying a ticket also marks the buyer as going, so reminders and change alerts reach ticket holders.
- Cancelling an event refunds every ticket automatically; the club's ticket desk can finish any refund Stripe could not make at the time.

## Costs

Stripe keeps about 2.9% + 30¢ of each card payment, deducted from the club's payout.
Express accounts also cost the platform about $2 per month for each club that receives a payout that month, plus about 0.25% + 25¢ per payout.
Wat2Do pays those Connect fees.

## Local and test-mode setup

Never use live keys outside production.

1. In the Stripe Dashboard, switch to test mode and enable Connect (Settings, Connect).
2. Fill in the platform profile and branding (icon, logo, brand colour) under Settings, Connect and Settings, Branding.
3. Put the test secret key in `backend/.env` as `STRIPE_SECRET_KEY=sk_test_...`.
4. Create a Connect webhook endpoint in test mode for `https://<tunnel or host>/api/webhooks/stripe`, listening to "Events on Connected accounts", with these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `account.updated`.
5. Put its signing secret in `backend/.env` as `STRIPE_WEBHOOK_SECRET=whsec_...`.
6. Set `"enabled": true` in `backend/controlbox/ticketing.json` for the local run only, or commit it once production is ready.

With the Stripe CLI, `stripe listen --forward-connect-to localhost:8000/webhooks/stripe` forwards Connect events locally and prints a temporary signing secret.

## Production rollout

The order matters, because ECS refuses to start a task whose task definition references a secret key that is missing from Secrets Manager.

1. Roll any secret key that was ever pasted into a chat, ticket or document.
2. Create the live Connect webhook endpoint for `https://wat2do.io/api/webhooks/stripe` with the events listed above.
3. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to the `wat2do/production/runtime` secret in AWS Secrets Manager.
4. Only then add both names to `runtime_secret_keys` in `infra/terraform/production/locals.tf` and let the Terraform workflow apply it.
5. Deploy, confirm `GET /clubs/<club_id>/payouts` reports `ticketing_enabled: false`, then set `enabled: true` in `backend/controlbox/ticketing.json` and deploy again.
6. Sell one real ticket to a test event, refund it from the ticket desk, and confirm both emails arrived.

## Operating it

- A club's ticket desk lives at `/club-panel/events/<event_id>`; the door scanner is at `/club-panel/events/<event_id>/scan`.
- A ticket's QR code opens `/tickets/<code>`; a club officer opening it sees a Check in button.
- Seats held by an abandoned checkout free themselves when the Checkout session expires, plus the controlbox grace period.
- A refund that fails is never marked done; retry it from the desk, and Stripe's idempotency keys stop any double refund.
- The Instagram ingestion agent cannot change a ticketed event or its dates; a database trigger skips its writes.
