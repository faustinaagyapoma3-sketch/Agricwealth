# AgriHarvest full-stack starter
Mobile-first agricultural project frontend, Node/Express backend, Supabase schema, Paystack-verified deposits, and manually reviewed withdrawals.

## Critical production notes
This is source code to deploy and configure, not a live payment service. Do not accept real funds until you configure your Supabase project, Render secrets, Paystack business account, legal terms and real project disclosures. This software does not establish a legal right to solicit investments and does not promise or calculate guaranteed returns. New accounts have zero balance; no activity, profit or payout is fabricated.

## Supabase
1. Create a Supabase project.
2. In SQL Editor, paste and run `supabase/schema.sql`.
3. In Authentication settings, set Site URL and Redirect URLs to your GitHub Pages URL.
4. Create your first account from the frontend, then find its UUID under Authentication → Users. In SQL Editor run `update public.profiles set role='admin' where id='YOUR-USER-UUID';` Only grant this role to a trusted administrator.
5. Copy Project URL and anon key from Project Settings → API.

## Render backend
1. Push this folder to a GitHub repository.
2. Create a Render Web Service connected to it; Root Directory `server`; Build `npm install`; Start `npm start`.
3. Add the values from `server/.env.example` as Render environment variables. The service role key and Paystack secret must stay on Render only.
4. Set `FRONTEND_ORIGIN` to the exact GitHub Pages origin, e.g. `https://username.github.io` (not a path).
5. Set `PAYSTACK_CALLBACK_URL` to your GitHub Pages URL plus `/?payment=return`.

## GitHub Pages frontend
1. Edit `public/app.js` and set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `API_BASE` to your actual project URL and Render URL.
2. Enable GitHub Pages for branch `main`, folder `/public`. If that isn't available in your repository settings, move the contents of `public/` to the repository root and select `/(root)`.
3. Test registration, email confirmation, login, and logout.

## Paystack deposits
The server initializes a Paystack transaction in GHS. After checkout, the backend verifies status, reference, currency and amount directly with Paystack before crediting the wallet. Use test keys first. Paystack availability, business approval and enabled payment channels are account-specific.

## Withdrawals
The UI supports MTN MoMo, Telecel Cash, AT Money and bank account. Requests reserve available balance atomically. Admin reviews, sends the payout outside the site, then records the actual payout reference to complete it. Rejecting a request releases reserved funds. Never mark a payout complete before the real payment has been sent and verified.

## Limitations before launch
- No investment order creation/activation or earnings engine is enabled. Do not accept investment subscriptions until real project terms and a compliant funding model are implemented.
- Add real support contacts, terms, privacy policy, identity checks where legally required, admin MFA, backups, monitoring, and independent security review.
- Confirm all applicable Ghanaian regulatory, tax, data-protection and payment requirements with qualified professionals.
- Verify all RLS policies and financial workflows in a separate test project before live use.
