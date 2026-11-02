# Supabase setup

## Database schema

Apply the SQL files in `supabase/migrations/` in filename order in the Supabase SQL Editor, or use [`supabase/COMPLETE_SETUP.sql`](./supabase/COMPLETE_SETUP.sql) as the consolidated setup script. Do not mix the consolidated script with partially applied migrations without first reconciling the project's migration history.

The initial migration creates:

- `profiles`, linked to Supabase Auth users, with unique phone numbers and protected roles.
- `menu_items`, `posters`, and `restaurant_settings`.
- `orders` and `order_items`.

The sample-menu migration adds ten example dishes across the existing categories, without replacing existing menu records. Apply `20261102000000_seed_sample_menu.sql` after the initial schema migration to show the sample menu. The customer page groups available dishes beneath category headings; category filters and search continue to narrow the results. Edit or remove sample dishes from the admin menu after signing in.

Apply the order-cancellation migration before deploying the updated API or website.

The GPS order-location migration adds nullable coordinates, reported accuracy, and capture time to orders. Existing orders and orders entered with a manual address remain valid. GPS coordinates are captured by the customer's browser and saved with the order; staff can open the saved pin from the order dashboard. Browser location accuracy depends on the device and its location signal and cannot be guaranteed as exact.

The order-cancellation migration adds the restaurant-stage and delivery-stage cancellation records, per-order food subtotal and delivery-charge snapshots, Razorpay payment references, and a refund-processing status separate from the order's `Cancelled` status. Cancellation eligibility and refund calculations use the order's database status and saved charge/payment amounts. The food-making deduction at the delivery stage is 10% of the saved food subtotal; the delivery deduction is the delivery charge saved for that order. Pre-migration orders do not have these order-specific snapshots and are not given estimated charges.

The migration enables RLS. Public reads are limited to available menu items, published posters, and the default restaurant settings. Authenticated customers can read only their own profile and orders. Client-side writes to restaurant data, order data, and roles are denied. Privileged API writes use the server-only service key after checking the signed-in Supabase user and role.

## Supabase Auth and email

1. In **Authentication → Providers → Email**, enable email/password and email OTP; keep email confirmation enabled.
2. In **Authentication → SMTP Settings**, enable custom SMTP and use Brevo's SMTP relay (`smtp-relay.brevo.com`, port `587`, STARTTLS), the SMTP login shown in Brevo, a Brevo-generated SMTP key, and a verified sender email/name. Do not use the Brevo API key as an SMTP password.
3. In **Authentication → Email Templates → Confirm signup**, include `{{ .Token }}` in the message so the existing six-digit code field continues to work.
4. Create an administrator account through Supabase Auth and verify its email.
5. After applying the migration, promote only that account in the SQL Editor:

   ```sql
   update public.profiles
   set role = 'admin', updated_at = now()
   where email = lower('ADMIN_EMAIL_ADDRESS');
   ```

   Replace the placeholder with the administrator account email. Verify exactly one row was updated before proceeding.

## Environment variables

Keep local values in `.env`, which is ignored by Git:

```text
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SECRET
RAZORPAY_KEY_ID=YOUR_RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET=YOUR_RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET=YOUR_RAZORPAY_WEBHOOK_SECRET
```

The server accepts the existing `NEXT_PUBLIC_...` URL and publishable-key names, but the explicit server-side names are recommended. Never put `SUPABASE_SERVICE_ROLE_KEY` in browser code or a `NEXT_PUBLIC_` variable. The old `ADMIN_API_KEY` and Brevo API key are not used by the Supabase Auth flow.

Razorpay credentials are server-only. Configure a Razorpay webhook at `/api/webhooks/razorpay` with the same webhook secret and subscribe to `refund.created`, `refund.processed`, and `refund.failed`. Enable/capture payments in Razorpay so the server can verify a captured payment before saving a UPI order; customer-provided payment totals are not trusted. When a paid order is cancelled, the server submits the calculated refund to Razorpay. If submission cannot be confirmed, the order retains an admin refund request. Admins can verify a manually issued refund by entering its Razorpay refund ID; the app checks Razorpay's returned payment, amount, and refund status before updating the displayed status.

## Run the application

- Run the Express development server with `npm start`.
- Keep the required Supabase environment variables in the local `.env` file when running locally. Production hosting must run the Node.js Express server so both the website and `/api/*` routes are available. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the hosting provider's server-side environment settings; never expose the service key to browser code.

## Import existing data

After applying the migration and setting `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY`, run:

```text
npm run migrate:supabase
```

The importer reads `.restaurant-data/store.json`, inserts only rows whose identifiers are not already present, and never deletes or edits the source files. Re-running it is safe for rows it has already inserted. It imports menu items, posters, orders, and any legacy order items; historical orders without items remain without invented line items.

The current project has no `.restaurant-data/customers.json`. If customer records are present when the importer runs, it stops before writing anything because the existing scrypt password hashes cannot be reused by Supabase Auth. Keep the source files until the import report and Supabase row counts have been checked.

The root `data.json` is a sample file; the running Express backend has used `.restaurant-data/store.json` as its data source. The importer intentionally does not import the sample file.

The former JSON-backed server is retained as `server.legacy.js` during verification. `npm start` runs the Supabase-backed API; do not run the legacy file once the migration begins.

The active website logic is inline in `index.html`; the existing `script.js` is an unreferenced duplicate and is not loaded by the page.

## Checks

Run `npm test` for local validation. Real OTP delivery, account login, role checks, and data import require the configured Supabase project and a test mailbox; do not use a production customer account for smoke tests.
