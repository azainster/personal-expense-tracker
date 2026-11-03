/**
 * On-device schema. Mirrors §5 of the architecture (the SwiftData models) in SQLite terms.
 * Money is always INTEGER minor units + ISO-4217 code — never a float.
 *
 * No OAuth tables: on the phone the refresh token lives in the iOS Keychain, never here.
 */
import type { SqlDriver } from './driver.js';

interface Migration {
  version: number;
  name: string;
  up: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE IF NOT EXISTS categories (
        key                  TEXT PRIMARY KEY,
        name                 TEXT NOT NULL,
        color_hex            TEXT NOT NULL,
        icon                 TEXT NOT NULL DEFAULT 'tag',
        sort_order           INTEGER NOT NULL DEFAULT 0,
        monthly_budget_minor INTEGER,
        is_system            INTEGER NOT NULL DEFAULT 1,
        excluded_from_totals INTEGER NOT NULL DEFAULT 0,
        created_at           TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id                       TEXT PRIMARY KEY,
        dedupe_key               TEXT NOT NULL,
        amount_minor             INTEGER NOT NULL,
        currency_code            TEXT NOT NULL,
        is_credit                INTEGER NOT NULL DEFAULT 0,
        occurred_at              TEXT NOT NULL,
        posted_at                TEXT,
        merchant_raw             TEXT NOT NULL,
        merchant_normalized      TEXT NOT NULL,
        merchant_display         TEXT NOT NULL,
        account_last4            TEXT,
        account_label            TEXT,
        gmail_message_id         TEXT NOT NULL UNIQUE,
        gmail_thread_id          TEXT,
        sender_address           TEXT NOT NULL,
        sender_kind              TEXT NOT NULL DEFAULT 'unknown',
        subject                  TEXT,
        parser_version           TEXT NOT NULL,
        extraction_method        TEXT NOT NULL,
        confidence               REAL NOT NULL DEFAULT 0,
        confidence_reasons       TEXT,
        category_key             TEXT REFERENCES categories(key) ON DELETE SET NULL,
        category_source          TEXT,
        is_user_confirmed        INTEGER NOT NULL DEFAULT 0,
        is_excluded_from_totals  INTEGER NOT NULL DEFAULT 0,
        is_transfer              INTEGER NOT NULL DEFAULT 0,
        needs_review             INTEGER NOT NULL DEFAULT 0,
        notes                    TEXT,
        source                   TEXT NOT NULL DEFAULT 'gmail',
        created_at               TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tx_occurred_at ON transactions(occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tx_dedupe_key  ON transactions(dedupe_key);
      CREATE INDEX IF NOT EXISTS idx_tx_merchant    ON transactions(merchant_normalized);
      CREATE INDEX IF NOT EXISTS idx_tx_category    ON transactions(category_key);
      CREATE INDEX IF NOT EXISTS idx_tx_parser      ON transactions(parser_version, extraction_method);
      CREATE INDEX IF NOT EXISTS idx_tx_amount      ON transactions(amount_minor, currency_code);

      CREATE TABLE IF NOT EXISTS transaction_links (
        id                     TEXT PRIMARY KEY,
        primary_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        duplicate_message_id   TEXT NOT NULL,
        duplicate_sender       TEXT,
        duplicate_merchant     TEXT,
        similarity             REAL NOT NULL DEFAULT 1.0,
        match_kind             TEXT NOT NULL DEFAULT 'exact',
        merged_at              TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_link_dupe ON transaction_links(duplicate_message_id);
      CREATE INDEX IF NOT EXISTS idx_link_primary ON transaction_links(primary_transaction_id);

      CREATE TABLE IF NOT EXISTS merchant_rules (
        normalized_name  TEXT PRIMARY KEY,
        display_name     TEXT NOT NULL,
        category_key     TEXT NOT NULL,
        source           TEXT NOT NULL DEFAULT 'bundled',
        is_user_override INTEGER NOT NULL DEFAULT 0,
        last_used_at     TEXT,
        hit_count        INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        account_email              TEXT PRIMARY KEY,
        last_history_id            TEXT,
        last_full_sync_at          TEXT,
        last_incremental_sync_at   TEXT,
        last_discovery_sweep_at    TEXT,
        backfill_completed_through TEXT,
        rules_pack_version         TEXT
      );

      CREATE TABLE IF NOT EXISTS parse_failures (
        id            TEXT PRIMARY KEY,
        sender_domain TEXT NOT NULL,
        subject_shape TEXT NOT NULL,
        occurred_at   TEXT NOT NULL DEFAULT (datetime('now')),
        stage_reached TEXT NOT NULL,
        reason        TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_failure_domain ON parse_failures(sender_domain);

      CREATE TABLE IF NOT EXISTS message_triage (
        gmail_message_id TEXT PRIMARY KEY,
        sender_domain    TEXT NOT NULL,
        decision         TEXT NOT NULL,
        parser_version   TEXT NOT NULL,
        seen_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        id             TEXT PRIMARY KEY,
        kind           TEXT NOT NULL,
        status         TEXT NOT NULL,
        phase          TEXT,
        started_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        finished_at    TEXT,
        listed         INTEGER NOT NULL DEFAULT 0,
        fetched        INTEGER NOT NULL DEFAULT 0,
        parsed         INTEGER NOT NULL DEFAULT 0,
        created        INTEGER NOT NULL DEFAULT 0,
        duplicates     INTEGER NOT NULL DEFAULT 0,
        skipped        INTEGER NOT NULL DEFAULT 0,
        failed         INTEGER NOT NULL DEFAULT 0,
        page_token     TEXT,
        error_code     TEXT,
        error_message  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);

      CREATE TABLE IF NOT EXISTS discovered_senders (
        sender_address TEXT PRIMARY KEY,
        sender_domain  TEXT NOT NULL,
        success_count  INTEGER NOT NULL DEFAULT 0,
        failure_count  INTEGER NOT NULL DEFAULT 0,
        promoted       INTEGER NOT NULL DEFAULT 0,
        first_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 2,
    name: 'financial_sources_and_categories',
    up: `
      -- Which account or card a transaction belongs to, and what the money did.
      ALTER TABLE transactions ADD COLUMN source_key   TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE transactions ADD COLUMN txn_kind     TEXT NOT NULL DEFAULT 'debit';
      ALTER TABLE transactions ADD COLUMN reference_id TEXT;
      ALTER TABLE transactions ADD COLUMN txn_time     TEXT;

      CREATE INDEX IF NOT EXISTS idx_tx_source       ON transactions(source_key);
      CREATE INDEX IF NOT EXISTS idx_tx_source_month ON transactions(source_key, occurred_at DESC);

      -- Existing rows predate source detection. A Pixel Play alert names the card in its
      -- subject; anything else from HDFC is the bank account.
      UPDATE transactions SET source_key = 'hdfc_pixel_play'
        WHERE source_key = 'unknown' AND sender_address LIKE '%hdfcbank%'
          AND lower(coalesce(subject, '')) LIKE '%pixel%';
      UPDATE transactions SET source_key = 'hdfc_bank'
        WHERE source_key = 'unknown' AND sender_address LIKE '%hdfcbank%';
      UPDATE transactions SET source_key = 'union_bank'
        WHERE source_key = 'unknown' AND sender_address LIKE '%unionbank%';
      UPDATE transactions SET txn_kind =
        CASE WHEN is_transfer = 1 THEN 'transfer' WHEN is_credit = 1 THEN 'credit' ELSE 'debit' END;

      -- The Cafe category becomes Chai: moved, not duplicated, so old rows keep their meaning.
      INSERT INTO categories (key, name, color_hex, icon, sort_order, is_system, excluded_from_totals)
        VALUES ('chai', 'Chai', '#B07A4B', 'cup', 3, 1, 0)
        ON CONFLICT(key) DO NOTHING;
      UPDATE transactions  SET category_key = 'chai' WHERE category_key = 'cafe';
      UPDATE merchant_rules SET category_key = 'chai' WHERE category_key = 'cafe';
      DELETE FROM categories WHERE key = 'cafe';
    `,
  },
  {
    version: 3,
    name: 'union_bank_sender_and_subscriptions',
    up: `
      -- Union Bank of India sends its alerts from ubi.bank.in. Rows stored before that address
      -- was known were filed as "Other"; they belong to the Union Bank account.
      UPDATE transactions SET source_key = 'union_bank'
        WHERE source_key = 'unknown'
          AND (lower(sender_address) LIKE '%ubi.bank.in%'
            OR lower(sender_address) LIKE '%ubibank%'
            OR lower(sender_address) LIKE '%unionbank%');

      -- Recurring services move to Subscriptions — but a category chosen by hand always wins,
      -- so confirmed rows and user overrides are left exactly as they are.
      UPDATE merchant_rules SET category_key = 'subscriptions'
        WHERE is_user_override = 0 AND normalized_name IN (
        'anthropic','openai','chatgpt','icloud','apple','apple music','google one','notion',
        'adobe','microsoft 365','canva','github','dropbox','linkedin premium','netflix','spotify',
        'youtube premium','google youtube','hotstar','disney plus','prime video','sonyliv','zee5',
        'jiocinema','audible','hulu','max'
      );
      UPDATE transactions SET category_key = 'subscriptions', category_source = 'dictionary',
             updated_at = datetime('now')
        WHERE is_user_confirmed = 0 AND coalesce(category_source, '') <> 'user'
          AND merchant_normalized IN (
        'anthropic','openai','chatgpt','icloud','apple','apple music','google one','notion',
        'adobe','microsoft 365','canva','github','dropbox','linkedin premium','netflix','spotify',
        'youtube premium','google youtube','hotstar','disney plus','prime video','sonyliv','zee5',
        'jiocinema','audible','hulu','max'
      );
    `,
  },
  {
    version: 4,
    name: 'anthropic_billed_to_pixel_play',
    up: `
      -- Anthropic's invoices are vendor mail and name no account, so earlier rows were filed
      -- as "Other". They are paid by the Pixel Play card (rules pack: merchantSourceHints).
      UPDATE transactions
        SET source_key = 'hdfc_pixel_play',
            account_label = 'HDFC Pixel Play Credit Card',
            updated_at = datetime('now')
        WHERE source_key = 'unknown' AND merchant_normalized = 'anthropic';
    `,
  },
  {
    version: 5,
    name: 'undo_sender_name_recategorisation',
    up: `
      -- Until now, categorising a transaction whose merchant was guessed from the sender
      -- ("hdfcbank") applied that category to every other unparsed alert from the same bank and
      -- learned it as a merchant rule. Undo both: these rows are unclassified until their real
      -- merchant is read from the email.
      DELETE FROM merchant_rules
        WHERE is_user_override = 1
          AND normalized_name IN (
            SELECT DISTINCT merchant_normalized FROM transactions
              WHERE confidence_reasons LIKE '%merchant inferred from sender%'
          );
      UPDATE transactions
        SET category_key = 'other', category_source = 'fallback', is_user_confirmed = 0,
            updated_at = datetime('now')
        WHERE confidence_reasons LIKE '%merchant inferred from sender%'
          AND category_source = 'user';
    `,
  },
  {
    version: 6,
    name: 'counterparty_vpa_and_reparse',
    up: `
      ALTER TABLE transactions ADD COLUMN counterparty_vpa TEXT;

      -- Templates for the real HDFC emails (Pixel Play activity, account UPI debit, account
      -- credit) arrived with this version. Rows parsed before them have the sender's name as
      -- their merchant and no usable detail, so they are removed and re-read on the next sync.
      -- Only recent, unconfirmed rows: anything older than the sync window could not be
      -- fetched again, and anything the person confirmed or categorised by hand is kept.
      DELETE FROM transaction_links WHERE primary_transaction_id IN (
        SELECT id FROM transactions
          WHERE confidence_reasons LIKE '%merchant inferred from sender%'
            AND is_user_confirmed = 0
            AND occurred_at >= datetime('now', '-30 days')
      );
      DELETE FROM message_triage WHERE gmail_message_id IN (
        SELECT gmail_message_id FROM transactions
          WHERE confidence_reasons LIKE '%merchant inferred from sender%'
            AND is_user_confirmed = 0
            AND occurred_at >= datetime('now', '-30 days')
      );
      DELETE FROM transactions
        WHERE confidence_reasons LIKE '%merchant inferred from sender%'
          AND is_user_confirmed = 0
          AND occurred_at >= datetime('now', '-30 days');
    `,
  },
];

export const STORE_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export const DATA_TABLES = [
  'transaction_links',
  'transactions',
  'merchant_rules',
  'sync_state',
  'parse_failures',
  'message_triage',
  'sync_runs',
  'discovered_senders',
  'app_settings',
  'categories',
];

export async function runStoreMigrations(db: SqlDriver): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(
    (await db.all<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => Number(r.version)),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    await db.transaction(async () => {
      await db.exec(migration.up);
      await db.run('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [migration.version, migration.name]);
    });
  }
}
