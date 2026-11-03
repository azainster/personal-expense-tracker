# Gmail-Sourced Expense Tracker — Architecture & Roadmap

**Platform:** iOS 18+ (target iOS 26 for on-device LLM) · Swift 6 / SwiftUI
**Status:** Design document, v1
**Date:** 2026-09-14

---

## 0. Read This First: The Single Biggest Constraint

Everything else in this document is negotiable. This is not:

> Reading Gmail message **bodies** requires the `gmail.readonly` scope, which Google classifies as a **Restricted Scope**. Shipping publicly on the App Store requires OAuth verification **plus** an annual third-party CASA (Cloud Application Security Assessment) audit.

Practical consequences:

| | Personal / <100 users | Public App Store |
|---|---|---|
| OAuth consent screen | "Testing" mode, manually-added test users | Published, verified |
| Google review | None | Weeks–months, video demo, privacy policy review |
| CASA assessment | None | Tier 2 assessment, **annual**, typically \$500–\$5,000+ |
| Refresh token lifetime | **Expires in 7 days** (testing mode) | Long-lived |

That 7-day refresh-token expiry in testing mode is the thing that will bite you on day three of development and make you think your token storage is broken. It isn't.

There is **no narrower scope that helps.** `gmail.metadata` is also restricted, and it strips bodies — you'd get sender/subject/date only, which is enough for maybe 30% of bank alerts (those that put the amount in the subject) and none of the merchant receipts.

**This reframes the whole project:** design as if it will be audited. An architecture where no server ever sees email content collapses the CASA scope to almost nothing and makes the video demo trivial to record. That drives the recommendation in §1.

### Plan B, if verification proves untenable

**Forwarding-address ingestion.** User creates a Gmail filter that auto-forwards matching mail to a unique per-user address (`u_8f3a@in.yourapp.com`). You receive it via an inbound-email provider, parse server-side, push to the app.

- Dodges OAuth and restricted scopes entirely
- Requires a backend and inbound mail infrastructure
- Setup friction is real: Gmail requires confirming a forwarding address via a code, plus manual filter creation. Budget a very good onboarding walkthrough.
- No historical backfill — only mail arriving after setup
- You now *do* hold email content on a server, so the privacy story inverts

Keep this in your back pocket. Don't build it first.

---

## 1. Architecture Recommendation

### Verdict: On-device processing, with two narrow stateless server-side assists.

Do **not** build a backend that fetches and stores mail. The "backend parses better" intuition was true in 2019; it isn't in 2026, and it's the expensive answer in every dimension that matters here.

```
┌──────────────────────────── iPhone ─────────────────────────────┐
│                                                                 │
│  ASWebAuthenticationSession ──► Google OAuth (PKCE, no secret)  │
│            │                                                    │
│            ▼                                                    │
│  ┌──────────────────┐   refresh_token → Keychain                │
│  │   AuthManager    │   (AfterFirstUnlockThisDeviceOnly)        │
│  └────────┬─────────┘                                           │
│           │ access_token                                        │
│           ▼                                                     │
│  ┌──────────────────┐  messages.list (q=…)  ┌─────────────────┐ │
│  │   GmailClient    │◄─────────────────────►│  Gmail REST API │ │
│  │  (batch, retry)  │  messages.get (full)  └─────────────────┘ │
│  └────────┬─────────┘                                           │
│           │ raw MIME parts (never persisted)                    │
│           ▼                                                     │
│  ┌──────────────────────────────────────────┐                   │
│  │  ParsingPipeline  (L0→L4 cascade, §3)    │                   │
│  │  ├─ sender template match                │                   │
│  │  ├─ JSON-LD / schema.org extraction      │                   │
│  │  ├─ scored regex candidate selection     │                   │
│  │  └─ FoundationModels fallback (on-device)│                   │
│  └────────┬─────────────────────────────────┘                   │
│           │ Transaction (struct)                                │
│           ▼                                                     │
│  ┌──────────────────┐   ┌──────────────────────────────┐        │
│  │  Deduplicator    │──►│ SwiftData (FileProtection    │        │
│  │  (amount/date/   │   │ Complete) + CloudKit private │        │
│  │   merchant fuzzy)│   └──────────────────────────────┘        │
│  └──────────────────┘              │                            │
│                                    ▼                            │
│                          SwiftUI Dashboard                      │
└─────────────────────────────────────────────────────────────────┘
             │                                    │
   (A) GET rules-pack.json           (B) opt-in, redacted only
             ▼                                    ▼
    ┌────────────────────┐            ┌──────────────────────────┐
    │ CDN — static JSON  │            │ LLM proxy (stateless,    │
    │ parser rules +     │            │ no logging, opt-in)      │
    │ merchant dictionary│            │ — only if on-device fails│
    └────────────────────┘            └──────────────────────────┘
```

### Why on-device wins here

**Audit surface.** "User email content never leaves the device" is a sentence that ends most of the CASA conversation. A server that ingests mail means data-retention policy, encryption-at-rest evidence, access controls, incident response, pen-test findings, subprocessor list. You will spend more time on that than on the app.

**Parsing quality is no longer the differentiator.** iOS 26's Foundation Models framework gives you a ~3B on-device model with *guided generation* — you hand it a `@Generable` Swift struct and it returns typed, schema-valid output. For "pull the amount and merchant out of this 400-token email," that is entirely sufficient. Free, offline, no per-call latency to a datacenter.

**Cost.** Server-side parsing of every email for every user, at frontier-model quality, is a real per-user monthly cost for an app most people will pay \$0 for.

**Breach blast radius.** You cannot leak a corpus of users' bank alerts if you never had one.

### What the server legitimately does

**(A) Rules pack — static CDN, no user data.** A signed JSON bundle of sender fingerprints, per-bank regex templates, and the merchant→category dictionary. Fetched daily. This is the critical escape hatch: when HDFC changes its alert template, you ship a fixed rules pack in hours instead of waiting a week for App Store review. **Build this in Phase 1, not later** — retrofitting a rules engine onto hardcoded parsers is a rewrite.

**(B) LLM fallback proxy — opt-in, redacted, stateless.** Only for emails the on-device cascade fails on. Redact before sending: strip account numbers, names, addresses, URLs with tokens; send a normalized snippet. Off by default, with a plain-language toggle. Zero-retention upstream config.

### What you give up, and the answers

| Lost | Answer |
|---|---|
| Push sync (`users.watch` needs Cloud Pub/Sub + a server) | `BGAppRefreshTask` + foreground sync. Expenses aren't real-time-critical. |
| Cross-device sync | **CloudKit private database.** Data stays in the user's own iCloud, encrypted, not yours. Strictly better for the privacy story. |
| Server-side parser hotfixes | The rules pack (A). |
| Heavy backfill compute | Chunk it, show progress, do it once at onboarding. |

---

## 2. Gmail API Strategy

### 2.1 OAuth 2.0 on iOS

**Non-negotiable:** Google rejects embedded `WKWebView` auth. Use the system browser.

Use **AppAuth-iOS + GTMAppAuth**, or Google Sign-In for iOS. AppAuth is the better choice — fewer dependencies, no Google Sign-In UI you don't need, full control over the token lifecycle.

Key points:

- **PKCE, no client secret.** Register an **iOS** OAuth client. Native clients are public clients; there is no secret to protect. If a tutorial tells you to embed a client secret, it's describing a web client — wrong type.
- **Redirect URI:** reverse-DNS custom scheme, `com.googleusercontent.apps.XXXX:/oauth2redirect`. Register in `CFBundleURLTypes`.
- `ASWebAuthenticationSession` under the hood — AppAuth handles this.
- **Request `access_type=offline` and `prompt=consent`** on first auth or you won't get a refresh token.
- **Incremental auth:** don't ask for Gmail at first launch. Show value first, then request. Consent-screen abandonment on a scary red "this app wants to read your email" warning screen is your largest funnel drop — earn the click.

**Token storage:**

```swift
// Refresh token — needs background access, so NOT WhenUnlocked
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.yourapp.gmail.refresh",
    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    kSecValueData as String: tokenData
]
```

`ThisDeviceOnly` prevents the token syncing to iCloud Keychain and landing on the user's other devices. Do **not** gate the refresh token behind `SecAccessControl` biometrics — background refresh will fail silently. Gate the *app* with Face ID instead if you want that UX.

Handle `invalid_grant` (revoked / password changed / 7-day testing expiry) by clearing the Keychain and surfacing a non-alarming re-connect prompt.

### 2.2 Query strategy — the part that determines your API cost

`messages.list` returns **IDs only**. Every body costs a separate `messages.get`. So the entire game is: make `list` precise enough that you rarely `get` an irrelevant email.

**Two-tier query design:**

**Tier 1 — Allowlist (high precision, runs every sync).** Built from the rules pack. These are senders you have a template for.

```
from:(alerts@hdfcbank.net OR noreply@icicibank.com OR auto-confirm@amazon.in
      OR receipts@uber.com OR no-reply@swiggy.in)
newer_than:35d
```

**Tier 2 — Discovery sweep (low precision, runs weekly / at onboarding).** Finds senders you don't know yet, so you can grow the allowlist.

```
(subject:(receipt OR invoice OR "transaction alert" OR debited OR "order confirmation"
          OR "payment received" OR "you paid")
 OR "has been debited" OR "transaction of" OR "amount of")
newer_than:35d -category:promotions -category:social -in:spam -in:trash
```

Results from Tier 2 that parse successfully get their sender promoted to a local allowlist. Results that fail get counted (count only — **never** the content) as a signal for which templates to write next.

**Gotchas:**

- `q` has a practical length ceiling. Chunk large `from:(...)` lists into several queries of ~20–30 senders rather than one giant string.
- `newer_than:35d` not `30d` — statement-boundary and timezone slop.
- `-category:promotions` is high-value; it's where most merchant marketing noise lives. But **test it** — some banks' mail lands in Promotions. Consider running one sweep *without* the exclusion at onboarding to measure.
- Gmail search is token-based, not substring. `subject:debit` will not match "debited" reliably; list variants explicitly.

### 2.3 Fetch efficiency

**Two-phase fetch.** Quota cost is 5 units for `messages.get` regardless of `format`, but bandwidth and parse time are not:

1. `format=metadata&metadataHeaders=From,Subject,Date` — cheap triage. Reject obvious non-transactions on subject alone.
2. `format=full` only for survivors.

For a 300-email month this typically cuts full-body fetches by half.

**HTTP batching.** Gmail exposes `POST https://gmail.googleapis.com/batch/gmail/v1` — up to 100 sub-requests per call. Cuts round-trips dramatically on backfill. *Verify this endpoint is still live against current docs before building on it* — Google retired the global batch endpoint years ago and per-API batch has been on a slow deprecation watch.

**Incremental sync after the first backfill:**

```
users.getProfile → historyId   (store it)
users.history.list(startHistoryId:, historyTypes: [messageAdded], labelId: INBOX)
```

`history.list` is 2 quota units vs 5 — and returns only what changed.

**Critical:** history records expire (Google guarantees roughly a week, sometimes less). If `history.list` returns **404**, the `historyId` is too old — you must fall back to a full `messages.list` re-sync. Write this fallback in Phase 1; it is not an edge case, it fires on any user who doesn't open the app for a week.

### 2.4 Quotas

Approximate, verify current values:

| Operation | Units |
|---|---|
| `messages.list` | 5 |
| `messages.get` | 5 |
| `history.list` | 2 |

Limits: ~250 units/user/second (moving average, bursts tolerated), ~1.2M units/minute/project.

You will not hit the project limit. You *can* hit the per-user limit during an aggressive backfill. Implement:

- Token-bucket client-side limiter, ~40 requests/sec ceiling
- Exponential backoff with **full jitter** on `429` / `403 rateLimitExceeded` / `5xx`
- Honor `Retry-After`
- Never retry `400` / `401` / `404` — fix the request or re-auth

---

## 3. Parsing & Extraction

Do not reach for an LLM first. A cascade is faster, cheaper, deterministic where it can be, and degrades gracefully.

### L0 — Sender fingerprint → template

Hash the `From` address against the rules pack. A direct hit means you know exactly where the amount lives. ~70% of volume, ~99% accuracy, sub-millisecond. This is where your effort pays off most.

### L1 — Structured data in the HTML

Genuinely underused. Many large merchants embed schema.org markup for Gmail's own annotation features:

```html
<script type="application/ld+json">
{"@type":"Order","orderNumber":"…","priceCurrency":"INR","price":"1249.00",
 "merchant":{"@type":"Organization","name":"…"}}
</script>
```

Parse `application/ld+json` blocks and microdata for `Order`, `Invoice`, `ParcelDelivery`. When present it's exact, typed data — no regex risk. Check this **before** regex.

### L2 — Scored candidate extraction (the workhorse)

The naive approach — "first currency-looking thing in the email" — fails constantly, because a bank alert contains the debit amount, the available balance, the credit limit, and sometimes reward points.

**Correct approach: extract every money-like span, score each, take the argmax.**

```swift
struct AmountCandidate {
    let minorUnits: Int
    let currency: String
    let range: Range<String.Index>
    var score: Double
}

// Positive signals within ±60 chars
let positive: [(String, Double)] = [
    ("debited", 3.0), ("charged", 3.0), ("you paid", 3.0),
    ("total", 2.5), ("amount", 2.0), ("txn", 2.0),
    ("order total", 3.0), ("grand total", 3.0),
]

// Negative — these are the ones that cause silent wrong answers
let negative: [(String, Double)] = [
    ("available balance", -5.0), ("avl bal", -5.0),
    ("credit limit", -5.0), ("outstanding", -4.0),
    ("you saved", -4.0), ("reward", -4.0), ("points", -4.0),
    ("cashback", -3.0), ("subtotal", -2.0), ("tax", -2.0),
    ("shipping", -2.0), ("discount", -3.0),
]
```

Additional scoring inputs: position (later "Total" lines usually win), typographic emphasis (`<b>`, larger font-size in inline styles), table-row adjacency to a label cell.

**Currency normalization is harder than it looks.** Handle:

- Indian grouping: `₹1,23,456.78` — *not* the 3-digit grouping every off-the-shelf regex assumes
- Symbol-before vs symbol-after: `$1,234.56`, `1.234,56 €`
- **Decimal separator ambiguity:** `1.234` is one thousand two hundred thirty-four in `de-DE` and one-point-two-three-four in `en-US`. Disambiguate by group-size heuristic (a `.` followed by exactly 3 digits with no other separator present is probably a thousands separator) plus the email's locale hints.
- Prefixes: `Rs.`, `INR`, `USD`, `Rs `, `₹`

**Store money as `Int` minor units + ISO-4217 code. Never `Double`.** `0.1 + 0.2 != 0.3`, and you will be summing thousands of these.

**Dates:** `NSDataDetector` handles most formats well. But the email's `Date` header is the *send* time, not the *transaction* time — for statements and delayed receipts these diverge by days. Prefer a date found in the body when one exists near the transaction language; fall back to the header.

### L3 — On-device LLM (iOS 26 Foundation Models)

For the residual — unknown sender, no structured data, low-confidence candidates:

```swift
import FoundationModels

@Generable
struct ExtractedTransaction {
    @Guide(description: "Transaction amount in major units, e.g. 1249.00")
    let amount: Double
    @Guide(description: "ISO 4217 code, e.g. INR, USD")
    let currency: String
    @Guide(description: "Merchant or payee name, cleaned of terminal IDs")
    let merchant: String
    @Guide(description: "true if this is a refund, reversal, or credit")
    let isCredit: Bool
    @Guide(description: "0.0–1.0 confidence this email is a real transaction")
    let confidence: Double
}

let session = LanguageModelSession(instructions: """
    Extract transaction details from this email. If it is marketing, a \
    statement summary, or a balance notification rather than a single \
    transaction, set confidence below 0.3.
    """)
let result = try await session.respond(
    to: cleanedEmailText,
    generating: ExtractedTransaction.self
)
```

Guided generation means you get a valid struct or an error — no JSON-repair code. Strip HTML to text and truncate to ~1500 tokens first; the context window is small and receipts are mostly boilerplate.

**Availability gate:** `SystemLanguageModel.default.availability` — the framework requires Apple Intelligence enabled and supported hardware. Always have L2 as the floor.

### L4 — Remote LLM (opt-in only)

Claude Haiku 4.5 for what L3 can't handle or when Apple Intelligence is unavailable. Redact first. Off by default.

### Deduplication — do not skip this

One coffee purchase can produce three emails: the bank debit alert, the merchant's receipt, and the payment app's confirmation. Naive summing **triples the user's reported spend**, which is the single most trust-destroying bug this app can have.

```
dedupeKey = hash(amountMinor, currency, floor(date to day), normalizedMerchant)
```

Then a fuzzy pass: same amount + currency, dates within ±3 days, merchant similarity (Jaro-Winkler > 0.85) **or** matching card last-4 ⇒ same transaction.

Merge rule: take the merchant name from the merchant receipt (cleaner), the account/card from the bank alert (authoritative), the earliest date.

**Merchant normalization** before comparison — bank descriptors are hostile:

```
"POS 4023XXXX5512 AMAZON RETAIL*MK1 BANGALORE IN" → "amazon"
"UPI/P2M/412345678/SWIGGY"                        → "swiggy"
```

Pipeline: uppercase → strip card fragments/terminal IDs/long digit runs → strip known city and country tokens → strip payment-rail prefixes (`POS`, `UPI`, `NEFT`, `ACH`, `SQ *`, `TST*`, `PAYPAL *`) → collapse whitespace → fuzzy match against the dictionary.

---

## 4. Categorization

Cascade again, cheapest first. Cache aggressively — you should classify each *distinct merchant* once, ever, not each transaction.

1. **User override table.** Highest priority, always. If the user has ever recategorized this merchant, that's the answer. Permanently.
2. **Merchant dictionary** (bundled + rules-pack updates). Normalized name → category. A few thousand entries covers the overwhelming majority of real spend.
3. **MCC code**, when the email includes it. Rare outside some bank alerts, but authoritative when present.
4. **Keyword rules** on merchant tokens — `CAFE`, `COFFEE`, `ROASTERS` → Cafe.
5. **Embedding similarity** — `NLEmbedding.sentenceEmbedding(for: .english)`, nearest neighbor against labeled category centroids. Good for long-tail local businesses.
6. **LLM classification** — one call per *new merchant string*, result written to the dictionary. Amortizes to near zero.

**The accuracy driver is #1.** Make recategorization a one-tap swipe, and always apply it retroactively to all past transactions from that merchant with a "Recategorized 14 past transactions — Undo" toast. Users forgive a wrong guess; they don't forgive having to fix it repeatedly.

Suggested starting taxonomy (flat, user-extensible): Groceries · Food & Dining · Cafe · Transport · Shopping · Bills & Utilities · Entertainment · Health · Travel · Transfers · Income · Other.

Keep **Transfers** distinct and excluded from spend totals — moving money between your own accounts is not expenditure, and counting it is the second-most trust-destroying bug.

---

## 5. Data Model (SwiftData)

```swift
import SwiftData

@Model
final class Transaction {
    #Index<Transaction>([\.occurredAt], [\.dedupeKey])

    @Attribute(.unique) var id: UUID
    var dedupeKey: String

    // Money: integer minor units + ISO 4217. Never Double.
    var amountMinor: Int
    var currencyCode: String
    var isCredit: Bool           // refunds, reversals, income

    var occurredAt: Date
    var postedAt: Date?

    var merchantRaw: String      // as it appeared in the email
    var merchantNormalized: String

    var accountLast4: String?
    var accountLabel: String?

    // Provenance — enables re-parsing without re-fetching
    var gmailMessageId: String
    var gmailThreadId: String
    var senderAddress: String
    var parserVersion: String
    var extractionMethod: String   // "template" | "jsonld" | "regex" | "llm-local" | "llm-remote"
    var confidence: Double

    var isUserConfirmed: Bool
    var isExcludedFromTotals: Bool
    var notes: String?

    @Relationship(deleteRule: .nullify) var category: Category?
    @Relationship(deleteRule: .cascade, inverse: \TransactionLink.primary)
    var duplicates: [TransactionLink]

    init(...) { ... }
}

@Model
final class Category {
    @Attribute(.unique) var id: UUID
    var name: String
    var systemKey: String?        // stable key for built-ins; nil for user-created
    var colorHex: String
    var sfSymbol: String
    var sortOrder: Int
    var monthlyBudgetMinor: Int?

    @Relationship(inverse: \Transaction.category) var transactions: [Transaction]
}

/// Merchant → category memory. The accuracy flywheel.
@Model
final class MerchantRule {
    @Attribute(.unique) var normalizedName: String
    var displayName: String
    var categoryKey: String
    var source: String            // "bundled" | "rulespack" | "llm" | "user"
    var isUserOverride: Bool      // wins over everything
    var lastUsedAt: Date
    var hitCount: Int
}

/// Links duplicate transactions discovered across sources.
@Model
final class TransactionLink {
    var primary: Transaction?
    var duplicateMessageId: String
    var similarity: Double
}

/// Sync bookkeeping — one row.
@Model
final class SyncState {
    @Attribute(.unique) var accountEmail: String
    var lastHistoryId: String?
    var lastFullSyncAt: Date?
    var lastIncrementalSyncAt: Date?
    var backfillCompletedThrough: Date?
    var rulesPackVersion: String
}

/// Content-free failure telemetry. NO email content, ever.
@Model
final class ParseFailure {
    var senderDomain: String      // domain only, not the address
    var subjectShape: String      // e.g. "Alnum-Cur-Alnum", never the subject
    var occurredAt: Date
    var stageReached: String
}
```

### Notes on the model

**Store `gmailMessageId`, not the email.** You get full re-parse capability when the rules pack improves, at the cost of one API call. Never persist bodies.

**`parserVersion` + `extractionMethod` are load-bearing.** When you fix a bank template, you need to find every transaction parsed by the broken version and re-run it. Without this field that's impossible.

**File protection.** SwiftData doesn't surface this in `ModelConfiguration`, so set it on the store file after creation:

```swift
try FileManager.default.setAttributes(
    [.protectionKey: FileProtectionType.completeUnlessOpen],
    ofItemAtPath: storeURL.path
)
```

Use `.completeUnlessOpen` rather than `.complete` — `.complete` will make background refresh fail when the device is locked.

**CloudKit sync:** if you enable it, every property needs a default value or must be optional, and `@Attribute(.unique)` is unsupported by the CloudKit mirror. Plan the model for this *before* you enable it, or it's a migration.

---

## 6. Implementation Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Restricted-scope verification + annual CASA** | **Critical** | On-device architecture collapses audit scope. Start the verification process early — it runs in parallel with development, and it is the long pole. Budget for the annual fee. |
| 7-day refresh token expiry in testing mode | High (dev friction) | Know it's expected. Don't debug your Keychain code. |
| Bank changes email template silently | High | Rules pack via CDN + content-free failure telemetry. Watch for a sender's parse-success rate falling off a cliff. |
| Triple-counting duplicates | High | §3 dedup. Test with a real multi-source month before shipping. |
| Transfers counted as spend | High | Dedicated excluded category; detect `to your own account`, `transfer to`, matching in/out pairs. |
| Gmail rate limits during backfill | Medium | Token bucket + jittered backoff + resumable checkpointing. |
| `historyId` expired (404) | Medium | Automatic fallback to full re-sync. Fires routinely. |
| `BGAppRefreshTask` gives ~30s | Medium | Checkpoint after each batch; resume next wake. Never assume a sync completes. |
| Consent-screen abandonment | Medium | Incremental auth — show value before asking. Pre-consent explainer screen in your own UI. |
| **App Store 5.1.1(v)** — account deletion | Medium | If you have accounts, in-app deletion is mandatory. Easiest answer: have no accounts at all. |
| App Store 5.1.2 — data use | Medium | Privacy nutrition labels must match reality. Mirror Google's **Limited Use** language verbatim in the privacy policy. |
| Multi-currency / FX | Medium | Store native currency per transaction; convert only at display time with a dated rate. Don't normalize on write. |
| Refunds, reversals, EMI, recurring | Medium | `isCredit` flag; refunds subtract. EMI: record the installment, not the principal. |
| HTML email parsing | Low–Med | Don't regex raw HTML. Strip to text first with a real parser; keep a DOM path for table-structured receipts. |
| Apple Intelligence unavailable | Low | L2 regex is always the floor. Gate on `SystemLanguageModel.default.availability`. |

**On App Review specifically:** Apple doesn't prohibit Gmail access, but expect the reviewer to need a working demo account. You can't hand them a real Gmail with real bank alerts. Prepare a **demo mode** with seeded fixture data, and explain it in App Review notes. Apps like this get rejected for "we couldn't test the core functionality" far more often than for policy.

---

## 7. Phase 1 MVP Scope

Goal: a working prototype **on your own Gmail account**, in testing mode, no App Store, no verification. Prove the parsing thesis before spending money on audits.

### Step 0 — Google Cloud setup
- [ ] Create project, enable Gmail API
- [ ] OAuth consent screen → **External**, **Testing**, add your own email as test user
- [ ] Create **iOS** OAuth client; record the reversed-DNS redirect scheme
- [ ] Add `gmail.readonly` scope

### Step 1 — Auth (the foundation; get it fully right)
- [ ] AppAuth-iOS via SPM
- [ ] `CFBundleURLTypes` entry for the reversed client ID
- [ ] Sign-in flow with `access_type=offline`, `prompt=consent`
- [ ] Keychain storage, `AfterFirstUnlockThisDeviceOnly`
- [ ] Automatic token refresh + `invalid_grant` → re-auth path
- [ ] Disconnect: revoke token, wipe Keychain, wipe local store

### Step 2 — Gmail client
- [ ] `messages.list` with `q` + pagination
- [ ] `messages.get` with `format=metadata` and `format=full`
- [ ] MIME walker → prefer `text/plain`, fall back to stripped `text/html`
- [ ] Base64url decoding (Gmail uses URL-safe alphabet — standard base64 decode will fail)
- [ ] Token-bucket limiter + jittered backoff
- [ ] **Debug screen dumping raw parsed text.** Build this on day one. You will live in it.

### Step 3 — Parsing v1 (narrow and deep, not broad and shallow)
- [ ] Pick your **top 3 senders by volume** in your own inbox. Only these.
- [ ] Rules pack JSON schema + bundled local copy (skip the CDN for now, just design the format correctly)
- [ ] L2 scored-candidate amount extraction with positive/negative keyword tables
- [ ] Currency parsing for your locale, `Int` minor units
- [ ] Date extraction with `NSDataDetector`, header fallback
- [ ] Merchant normalization pipeline
- [ ] **Golden-file test suite** — save 30–50 real emails as fixtures with hand-labeled expected output. This is the highest-leverage thing in Phase 1. Every parser change runs against it.

### Step 4 — Storage
- [ ] SwiftData models per §5 (skip CloudKit for now, but keep the model CloudKit-compatible)
- [ ] File protection attribute on the store
- [ ] Dedup on insert

### Step 5 — Categorization v1
- [ ] ~12 built-in categories seeded
- [ ] Bundled merchant dictionary — start with ~200 entries you actually transact with
- [ ] Keyword fallback → `Other`
- [ ] Tap to recategorize, with retroactive apply + undo

### Step 6 — Dashboard
- [ ] Month total, with month switcher
- [ ] Swift Charts donut by category
- [ ] Category list with amounts and %
- [ ] Drill-down to transaction list
- [ ] Transaction detail with a **"view source email"** link (`googlegmail://` or web) — essential for trust and for your own debugging
- [ ] Empty and syncing states

### Step 7 — Sync loop
- [ ] Manual pull-to-refresh
- [ ] Initial backfill: current month, resumable, with progress
- [ ] `historyId` incremental sync + 404 → full re-sync fallback
- [ ] `BGAppRefreshTask` registration

### Explicitly out of scope for Phase 1
Multi-account · budgets · LLM fallback (L3/L4) · CloudKit sync · widgets · CSV export · remote rules CDN · Plaid or any bank aggregator · anything requiring Google verification

### Phase 1 exit criteria

Run it against your own inbox for one full month. It passes when:

- **≥90% recall** on transactions you know exist (count manually against your actual statement)
- **≥95% precision** on amounts for your top-3 senders
- **Zero duplicates** in the month total
- The dashboard total matches your hand-tallied total within ~2%

If you can't hit these on *your own* inbox with three hand-tuned templates, broadening to more senders won't help — the pipeline design needs work first.

---

## 8. Recommended Sequencing Beyond MVP

- **Phase 2:** Discovery sweep + rules-pack CDN + L3 on-device LLM. Broadens sender coverage without app updates. Still personal use.
- **Phase 3:** CloudKit sync, budgets, widgets, Siri/Shortcuts, CSV export.
- **Phase 4:** Begin Google verification + CASA. Only once Phases 1–3 prove the product is worth the annual cost.

Deliberately putting verification last: it's the one step that costs real money and months of calendar time, and it's the one you'd most regret paying for if the parsing thesis doesn't hold up.
