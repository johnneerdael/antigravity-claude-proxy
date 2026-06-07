/**
 * SQLite Database - Call Log Storage
 * Stores API call history for analytics dashboard.
 * Uses better-sqlite3 (synchronous, already in dependencies).
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const DB_DIR = join(homedir(), '.config', 'antigravity-gateway');
const DB_PATH = join(DB_DIR, 'call-logs.db');

// Ensure directory exists
mkdirSync(DB_DIR, { recursive: true });

export const db = new Database(DB_PATH);

// WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS api_calls (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp             TEXT    NOT NULL,
    date                  TEXT    NOT NULL,
    hour                  INTEGER NOT NULL,

    endpoint              TEXT    NOT NULL,
    model                 TEXT    NOT NULL,
    account               TEXT,
    stream                INTEGER NOT NULL DEFAULT 0,

    status                TEXT    NOT NULL,
    input_tokens          INTEGER NOT NULL DEFAULT 0,
    output_tokens         INTEGER NOT NULL DEFAULT 0,
    total_tokens          INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    duration_ms           INTEGER,

    error_type            TEXT,
    error_message         TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_date      ON api_calls(date);
  CREATE INDEX IF NOT EXISTS idx_model     ON api_calls(model);
  CREATE INDEX IF NOT EXISTS idx_account   ON api_calls(account);
  CREATE INDEX IF NOT EXISTS idx_hour      ON api_calls(date, hour);
  CREATE INDEX IF NOT EXISTS idx_status    ON api_calls(status);
`);

// Migrate existing DB: add cache columns if they don't exist yet
const existingCols = db.prepare(`PRAGMA table_info(api_calls)`).all().map(c => c.name);
if (!existingCols.includes('cache_read_tokens')) {
    db.exec(`ALTER TABLE api_calls ADD COLUMN cache_read_tokens     INTEGER NOT NULL DEFAULT 0`);
}
if (!existingCols.includes('cache_creation_tokens')) {
    db.exec(`ALTER TABLE api_calls ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0`);
}
if (!existingCols.includes('request_system_len')) {
    db.exec(`ALTER TABLE api_calls ADD COLUMN request_system_len  INTEGER`);
    db.exec(`ALTER TABLE api_calls ADD COLUMN request_messages    INTEGER`);
    db.exec(`ALTER TABLE api_calls ADD COLUMN request_tools       INTEGER`);
    db.exec(`ALTER TABLE api_calls ADD COLUMN request_chars       INTEGER`);
}
if (!existingCols.includes('optimized')) {
    db.exec(`ALTER TABLE api_calls ADD COLUMN optimized INTEGER NOT NULL DEFAULT 0`);
}
if (!existingCols.includes('response_output_chars')) {
  db.exec(`ALTER TABLE api_calls ADD COLUMN response_output_chars INTEGER`);
  db.exec(`ALTER TABLE api_calls ADD COLUMN response_hash TEXT`);
  db.exec(`ALTER TABLE api_calls ADD COLUMN request_hash_before_opt TEXT`);
  db.exec(`ALTER TABLE api_calls ADD COLUMN request_hash_after_opt TEXT`);
  db.exec(`ALTER TABLE api_calls ADD COLUMN optimizer_saved_chars INTEGER`);
  db.exec(`ALTER TABLE api_calls ADD COLUMN optimizer_saved_messages INTEGER`);
}

// Settings table (key-value store for persistent settings like optimizer config)
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);
