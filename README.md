# Gmail-Sourced Expense Tracker

An iPhone app that reads receipts and bank alerts from Gmail, extracts each expense on the
device, counts every purchase once, categorizes it, and shows where the money went.

Built from `expense-tracker-architecture.md`. **Start with [SETUP.md](SETUP.md)** for step-by-step
setup, running on an iPhone, and TestFlight.

```
expense-tracker/
├── mobile/            iPhone app — Expo SDK 57 / React Native 0.86, expo-router, TypeScript
├── packages/core/     the engine, shared by app and server: parsing cascade, Gmail client,
│                      sync engine, dedupe, categorization, SQL store, rules pack, fixtures
├── server/            API for the app (/api/v1: rules pack, AI fallback proxy) and a
│                      local-only development dashboard backend
├── web/               development dashboard (React + Vite), local use only
├── render.yaml        deploys the API
└── SETUP.md
```

## Architecture (§1 of the spec)

Processing happens **on the iPhone**. No server fetches, stores or sees email.

- **Sign-in** — Google OAuth in the system browser sheet (ASWebAuthenticationSession), an iOS OAuth
  client with PKCE and no secret, redirect `com.googleusercontent.apps.<id>:/oauth2redirect`,
  `access_type=offline` + `prompt=consent`. Scope: `gmail.readonly` only. The refresh token is kept
  in the Keychain (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`); access tokens stay in memory.
  `invalid_grant` wipes the Keychain entry and shows a reconnect prompt.
- **Gmail** — Tier-1 allowlist queries built from the rules pack, a weekly Tier-2 discovery sweep,
  two-phase fetch (metadata triage, then full body for survivors), `history.list` incremental sync
  with the 404 → full re-sync fallback, token bucket, full-jitter backoff honouring Retry-After.
- **Parsing** — L0 sender templates → L1 JSON-LD → L2 scored amount candidates → L4 remote model
  (opt-in, redacted, via the API). Money is integer minor units. Charset-aware MIME decoding.
- **Dedupe** — exact key plus a fuzzy pass (±3 days, Jaro-Winkler > 0.85 or card last-4). The bank
  alert, the receipt and the payment-app email for one purchase merge into one transaction, and the
  merge is shown in the UI.
- **Categories** — user override → dictionary → MCC → keywords → similarity → model. Recategorizing
  applies retroactively to every past transaction from that merchant, is remembered, and has Undo.
  Transfers and income are excluded from spend; refunds subtract.
- **Storage** — SQLite on the device with the `NSFileProtectionCompleteUnlessOpen` data-protection
  entitlement. Stored: the extracted transaction and Gmail message ID. Never stored: email bodies.
  Parse-failure telemetry records sender domain and subject *shape* only.
- **Sync** — pull to refresh, automatic sync on opening the app, background refresh through
  BGTaskScheduler with a deadline and checkpointing so a cut-off run resumes.
- **Rules pack** — bundled in the app; a newer validated pack is fetched daily from
  `/api/v1/rules-pack`, so a broken bank template is fixed without an App Store release.
- **Demo mode** — the 39-email golden corpus, run through the real parser, for first look and App Review.

L3 (Apple's on-device Foundation Models) is not included: it has no stable React Native binding.
L2 is the floor the spec requires, and L4 covers the residual.

## The app

Onboarding → pre-consent explainer → Google sign-in → first sync with progress.
**Overview**: total expenditure for the month with a switcher, change vs last month, per-account
totals (tap one for that account's transactions), an account filter that scopes every figure below
it, donut by category, category list with amounts and share, category drill-down, needs-review
prompt, daily spending, top merchants.
**Transactions**: grouped by day, search, account filter, needs-review queue, not-counted filter.
**Detail**: recategorize with retroactive apply and Undo, confirm, notes, count-in-spending
toggle, account, masked card/account number, purchase/refund/transfer type, time, bank reference,
merged emails, "Open in Gmail", "Show how this was read".
**Settings**: connection, sync, sync activity (runs, skipped senders, content-free failures), rules
pack updates, AI fallback toggle, Parser lab, demo data, privacy, disconnect, erase everything.
Loading, empty, offline, error and reconnect states throughout; light and dark mode.

## Accounts and categories

Three financial sources are tracked separately, all from the one connected Gmail account:

| Key | Account |
|---|---|
| `hdfc_bank` | HDFC Bank account |
| `hdfc_pixel_play` | HDFC Pixel Play credit card |
| `union_bank` | Union Bank of India account |

HDFC sends the bank account's and the card's alerts from the same address, and every Pixel Play
email also opens with "Greetings from HDFC Bank!", so the account is decided by wording, never by
the sender alone. `identifyFinancialSource` (packages/core/src/parsing/sources.ts) runs **before**
any parsing and before the transaction type is worked out: `financialSources` in the rules pack
lists sender addresses/domains plus subject and body patterns, highest `priority` first, so the
Pixel Play rule (priority 30) is checked before the bank account rule (20), and the bank rule also
carries `negativeBodyPatterns` for `\bpixel\b` so it can never claim a card email. Evidence order:
subject/body pattern → the sender's `defaultSourceKey` → `merchantSourceHints` (a vendor's own
invoice, which names no account). Once the account is known, `templatesForSource` lets only that
product's templates parse the email, so card wording can never be read by a bank-account template.
Mail from a merchant or another bank stays "Other".

The transaction type is decided separately and afterwards: "Credit Card" is an account, not a
credit. A Pixel Play charge is `purchase`, an account UPI payment is `debit`, and money arriving is
`credit`. Only `debit` and `purchase` count as expenditure — credits, refunds and transfers stay in
history but are excluded from every total.

The source is part of a transaction's identity: it goes into the dedupe key, and two transactions
whose known sources differ are never merged, so an HDFC Bank debit and a Pixel Play charge for the
same amount on the same day stay separate. A bank alert and the merchant's own receipt for one
purchase still merge, because the receipt names no account.

**Adding another account** is a rules-pack edit, not a code change: add an entry to
`financialSources` (and a `senders` rule with templates if it is a new bank), then bump `version`.
Nothing about Gmail authentication is involved — source parsing is deliberately independent of it,
so connecting a second mailbox later changes none of this.

Categories: Groceries, Food & Dining, Chai, Transport, Travel, Shopping, Bills & Utilities,
Subscriptions, Entertainment, Health, Stuff, Transfers, Income, Miscellaneous. Chai covers chai and
cafe vendors; Food & Dining is a meal rather than a drink; Stuff is the small-purchases bucket you
want kept out of Miscellaneous, which stays the fallback when the email says too little.
Transfers and Income are excluded from spending; refunds subtract from the category they were
charged to. A category chosen by hand wins permanently: it is stored as a user override on the
normalized merchant, applied to that merchant's past and future transactions, and no sync overwrites
it.

## Commands

```bash
npm install          # also builds packages/core
npm test             # core 182 tests · server 20 · app 7
npm run typecheck    # core, server, web, mobile
npm run lint         # mobile
npm run mobile       # development server for the iPhone development build
npm run mobile:web   # browser preview with demo data
npm run server       # API on :4000
npm run dev          # development dashboard on :5173
```

## API

| Route | Purpose |
|---|---|
| `GET /api/v1/health` | status, rules pack version, whether the AI fallback is enabled |
| `GET /api/v1/rules-pack` | rules pack JSON, ETag / `304` |
| `POST /api/v1/llm/extract` | redacted snippet → typed transaction (off unless `LLM_PROXY_ENABLED=true`) |
| `POST /api/v1/llm/categorize` | merchant name → category key |

The development dashboard routes (`/api/auth`, `/api/transactions`, `/api/stats`, `/api/sync`,
`/api/debug`) are disabled in production and answer only loopback requests in development.
Server configuration: `.env.example`. App configuration: `mobile/.env.example`.

## Tests

- **packages/core** — golden corpus (39 hand-labelled emails), candidates, money, merchant, dedupe,
  categorize, extraction; the on-device SQL store against real SQLite (no double/triple counting,
  transfers/income, refunds, local-time months, retroactive recategorize + undo, demo data never
  merging with real mail); the sync engine against a mocked Gmail (two-phase fetch, history cursor,
  404 fallback, 429 retry, 401 refresh-and-retry, deadline pause and resume, redaction before the
  model); pure-JS base64/UTF-8/SHA-256 pinned to Node's output; a guard that fails if engine code
  uses Node-only APIs.
- **server** — the development dashboard's ingest and sync paths.
- **mobile** — OAuth redirect derivation and configuration helpers.
