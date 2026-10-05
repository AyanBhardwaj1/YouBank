# Launch day: billing on a custom domain

The steps to take YouBank from the beta (free, on `youbank-nu.vercel.app`) to paid plans on your own
domain. Follow them in order; each says how to check it worked. Plan on about two hours, plus DNS and
Stripe's account review, which can take a day: do steps 1 and 3 a few days early.

Throughout, `youbank.com` stands for your domain.

What is already built: plans and prices (`src/lib/billing/plans.ts`), AI credit packs
(`src/lib/billing/packs.ts`), Checkout, the customer portal, the webhook, team seats, the Plan tab
(Settings, under Plan), the public `/pricing` page and draft legal pages. Why the prices are what they
are: [pricing.md](pricing.md).

## Before you start

- [ ] Have counsel review `/terms`, `/privacy` and `/refunds` (`src/app/terms`, `src/app/privacy`,
      `src/app/refunds`). Fill the bracketed gaps (legal name, contact address, liability terms), then pass
      `reviewed` to `LegalPage` on each page to remove the "Draft" banner.
- [ ] Recommended: rehearse steps 4 to 7 in Stripe **test mode** on a Vercel Preview deployment with its
      own Neon branch (`--domain https://<preview url>` and a `sk_test_` key). Test cards:
      `4242 4242 4242 4242`; a card that needs 3-D Secure: `4000 0027 6000 3184`.

## 1. Buy the domain and add it in Vercel

1. Buy `youbank.com` from any registrar, or in Vercel (Domains, Buy).
2. Vercel, the YouBank project, **Settings, Domains**: add `youbank.com` and `www.youbank.com`. Set
   `www.youbank.com` to redirect (308) to `youbank.com`.
3. At the registrar, create the DNS records Vercel shows (an `A` record for the apex and a `CNAME` for
   `www`), or move the nameservers to Vercel.
4. Wait for both domains to show **Valid Configuration** and a certificate.
5. Sign-in on the new domain:
   - Neon Console, the project, **Auth**: add `https://youbank.com` to the trusted domains (allowed
     origins), or sign-in there fails with an "invalid domain" error.
   - Google Cloud Console, the OAuth client used for Gmail: add `https://youbank.com` as an authorised
     JavaScript origin and `https://youbank.com/api/crm/gmail/callback` as an authorised redirect URI.
     Keep the old ones until everyone has moved.
6. The Neon Functions that run the heartbeats call the app at `YOUBANK_URL`. Redeploy them with the new
   address (the commands are at the top of `neon/autopilot.ts` and `neon/news.ts`):
   `--env YOUBANK_URL=https://youbank.com`.

Check: `https://youbank.com` loads the landing page, and you can sign in there.

## 2. Set `NEXT_PUBLIC_SITE_URL`

Vercel, **Settings, Environment Variables**, Production only:

```
NEXT_PUBLIC_SITE_URL=https://youbank.com
```

This is the one setting every domain-dependent link reads (`src/lib/site.ts`): Checkout's return pages,
the billing portal's return link, links in news, Edge and autopilot emails and Slack, team invitations,
Open Graph and canonical URLs, `sitemap.xml`, `robots.txt`, and the webhook URL that `stripe-setup`
registers. It is built into the client bundle, so **redeploy** after setting it (Deployments, the latest
Production deployment, Redeploy).

Check: `https://youbank.com/sitemap.xml` lists `https://youbank.com/...` addresses, and
`https://youbank.com/robots.txt` names `https://youbank.com/sitemap.xml`.

## 3. Activate the Stripe account

In the Stripe Dashboard (live mode):

1. **Activate payments**: business details, representative, bank account for payouts. Turn on two-step
   authentication for every team member.
2. **Settings, Business, Public details**: business name, support email and phone, statement descriptor
   (for example `YOUBANK`), website `https://youbank.com`, terms of service `https://youbank.com/terms`,
   privacy policy `https://youbank.com/privacy`, refund policy `https://youbank.com/refunds`.
3. **Settings, Customer emails**: turn on emails for successful payments and for refunds, so every
   payment gets a Stripe receipt. Turn on the reminder and failed-payment emails for subscriptions under
   **Settings, Billing, Subscriptions and emails**, and Smart Retries for failed payments.
4. **Settings, Billing, Invoices**: set the invoice prefix and footer (legal name and address).

Check: the dashboard no longer shows "Activate your account", and **Developers, API keys** shows a live
secret key (`sk_live_...`). Copy it to your password manager; it is shown in full only once.

## 4. Run `stripe-setup --live --webhook`

From a checkout of the repository on the branch you are deploying, first see what it will do:

```
NEXT_PUBLIC_SITE_URL=https://youbank.com pnpm exec tsx scripts/stripe-setup.ts --dry-run --webhook
```

Then run it for real:

```
STRIPE_SECRET_KEY=sk_live_... NEXT_PUBLIC_SITE_URL=https://youbank.com \
  pnpm exec tsx scripts/stripe-setup.ts --live --webhook
```

Add `--tax` if you are ready to collect tax now (otherwise step 8). It:
- creates the products and prices for Pro, Deal Team and Enterprise (monthly and yearly where sold) and
  the $10, $25 and $50 credit packs;
- creates the webhook endpoint `https://youbank.com/api/billing/webhook` for exactly these events:
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
  `charge.refunded`;
- configures the customer portal: card, billing address and tax ID, invoice history, switching plans and
  intervals, seat counts (Deal Team 3 to 500, Enterprise 5 to 500), cancellation at the end of the period
  with a reason, downgrades at the end of the period;
- prints every environment variable to set.

**Copy the `STRIPE_WEBHOOK_SECRET=whsec_...` line now.** Stripe shows it only when the endpoint is
created. If you lose it, reveal it in the Dashboard, Developers, Webhooks, the endpoint, Signing secret.

Safe to run again: it finds everything it made and updates it. If a price changes later, rerunning makes a
new price, and people already paying keep theirs until they change plan.

## 5. Set the environment variables in Vercel

Vercel, **Settings, Environment Variables**, **Production** only, the lines the script printed:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...
STRIPE_PRICE_TEAM_MONTHLY=price_...
STRIPE_PRICE_TEAM_YEARLY=price_...
STRIPE_PRICE_ENTERPRISE_YEARLY=price_...
STRIPE_PRICE_PACK_AI10=price_...
STRIPE_PRICE_PACK_AI25=price_...
STRIPE_PRICE_PACK_AI50=price_...
STRIPE_PORTAL_CONFIGURATION=bpc_...
STRIPE_AUTOMATIC_TAX=0            (1 after step 8)
STRIPE_TERMS_CONSENT=1            (needs the terms URL from step 3.2; 0 otherwise)
```

- Preview deployments must never get the live key. Give Preview a `sk_test_` key and the test-mode lines
  from a test run of the script, or leave Stripe unset there (billing then shows as not switched on).
- If `AI_USER_DAILY_USD` or `AI_USER_MONTHLY_USD` were set for the beta, **delete them**: they replace
  every plan's allowance, so paying customers would get the beta's amounts instead of their plan's.
- Do not redeploy yet: the database needs the new tables first (step 6).

## 6. Apply the migrations

Billing needs `drizzle/0015_plans.sql` (plans) and `drizzle/0022_credits.sql` (credit packs, seats and
billing dates), plus any other numbered file in `drizzle/` that production has not had yet. They only add
tables and columns, and are safe to run twice.

1. Try them on a Neon branch of production first:
   ```
   DATABASE_URL=<branch connection string> pnpm exec tsx scripts/apply-sql.mts drizzle/0015_plans.sql drizzle/0022_credits.sql
   ```
2. Then on production (the direct, unpooled connection string):
   ```
   DATABASE_URL=<production connection string> pnpm exec tsx scripts/apply-sql.mts drizzle/0015_plans.sql drizzle/0022_credits.sql
   ```
3. Now redeploy production (Deployments, Redeploy), so the variables from step 5 take effect.

Check: the deployment's logs show no "environment check" warning naming `STRIPE_` or
`NEXT_PUBLIC_SITE_URL`. Settings, under Plan, shows the plans with **Choose** buttons, and the credit packs
with **Buy** buttons, instead of "Billing isn't switched on yet".

## 7. Test with a real card, then refund it

Use your own account (not an administrator in `ADMIN_EMAILS`: administrators are always Enterprise and
uncapped, so they cannot see a plan change) and your own card.

1. Settings, under Plan: **Choose Pro**, monthly. Pay on Stripe's page.
   - Back in YouBank: "Thank you. You are on Pro now." The plan shows Pro, "renews on" a date one month
     from today, and the AI allowance shows $25 for this month, resetting on that date.
   - Stripe, Developers, Webhooks, the endpoint: `checkout.session.completed` and
     `customer.subscription.created` were delivered with **200**.
2. **Buy the $10 pack**. Back in YouBank: "$6 of AI credits were added". The pack shows under AI credit
   packs. The webhook shows `checkout.session.completed` with 200.
3. **Invoices and receipts** lists the Pro invoice and the pack receipt, with links to Stripe's pages.
4. **Manage billing** opens Stripe's portal: the invoice history, the card, and the plans you can switch
   to are there. Choose **Cancel plan**. Back in YouBank the plan line says **Cancels on <date>**.
5. Refund both payments: Stripe Dashboard, Payments, each payment, **Refund**. Then Subscriptions, the
   Pro subscription, **Cancel subscription**, **immediately**.
   - YouBank, within a few seconds: the plan is Free again, and the pack's credits are gone
     (`charge.refunded` and `customer.subscription.deleted` delivered with 200).
6. Optional, for teams: with a colleague on a team you own (the Team page), buy Deal Team (three seats),
   give them a seat in Settings, under Plan, and check that their Plan tab says their seat comes from
   you. Lower the seats in the portal and check the seat is taken back. Refund afterwards.

If a webhook shows a 4xx or 5xx: a 400 "Invalid signature" means `STRIPE_WEBHOOK_SECRET` is wrong; a 503
means it is missing; a 500 carries a reference to find in the logs. Stripe retries failed deliveries for
three days, so after a fix use **Resend** on the failed event.

## 8. Turn on Stripe Tax and check Radar

**Stripe Tax** (ask your accountant where you must register):
1. Dashboard, Tax: add your head-office address, and a registration for each place you are registered to
   collect tax (US states where you have nexus; the EU OSS scheme and UK VAT if you sell there).
2. Run `STRIPE_SECRET_KEY=sk_live_... NEXT_PUBLIC_SITE_URL=https://youbank.com pnpm exec tsx scripts/stripe-setup.ts --live --tax`.
   It sets tax-exclusive prices with the SaaS tax code and reports anything missing.
3. Set `STRIPE_AUTOMATIC_TAX=1` in Vercel (Production) and redeploy. Checkout then collects the address it
   needs, computes tax, and accepts business tax IDs. The margins in `pricing.md` already count Stripe
   Tax's 0.5% fee.

**Radar** is on by default for card payments. In Dashboard, Radar, Rules, check that these are on:
- block if the CVC check fails;
- block if the postal code check fails;
- request 3-D Secure when the card supports it and Radar's risk is elevated;
- review payments with an elevated risk score.

Also turn on **Settings, Billing, Subscriptions and emails, Manage failed payments** so cards that fail
are retried and the customer is emailed a link to update them.

## 9. Send the beta-users notice

Tell everyone using the beta before anything is billed. Nobody is charged without choosing a plan: beta
accounts move to Free (Campus with a .edu address), with its smaller AI allowance, from launch day.

Suggested email (send at least 14 days before the AI allowances change, if you can):

> **Subject: YouBank's plans, and what changes for you on <date>**
>
> Thank you for using YouBank during the beta. From <date>, YouBank has paid plans:
> - **Free** stays free: the terminal, filings, comps, the Newsroom and every calculator, with a small AI
>   allowance. **Campus** is free with a .edu address.
> - **Pro** is $59 a month ($49 billed yearly), **Deal Team** $149 per seat ($125 yearly, three seats
>   minimum), **Enterprise** $299 per seat billed yearly.
> - Every plan includes a monthly AI allowance. If you need more, AI credit packs start at $10 and never
>   expire.
>
> Nothing changes until <date>, and nobody is charged unless they choose a plan. On <date> your account
> moves to Free unless you pick a plan in Settings, under Plan. Everything you have made stays.
>
> Prices and a full comparison: https://youbank.com/pricing. Terms: https://youbank.com/terms.
> Questions: reply to this email.

Check: send it to yourself first, and that every link opens on `youbank.com`.

## Afterwards

- **Watch the first week**: Stripe, Developers, Webhooks (every delivery 200), Payments (disputes),
  Billing (failed payments). In YouBank, Settings, AI usage shows spend by feature.
- **Changing a price**: edit `PLANS` (or `CREDIT_PACKS`), run `pnpm exec tsx scripts/test-billing.ts`
  (it fails if a margin drops below target), rerun `stripe-setup --live`, set the printed price ids,
  redeploy. Existing subscribers keep their price until they change plan.
- **Turning billing off in an emergency**: delete `STRIPE_SECRET_KEY` in Vercel and redeploy. Checkout,
  the portal and the webhook stop (Stripe retries webhooks for three days); everyone keeps the plan that is
  stored, and nothing in Stripe is cancelled.
