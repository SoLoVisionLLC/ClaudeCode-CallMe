/**
 * SQLite Database for User Storage
 * Subscription-based model with monthly minutes
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';

export interface User {
  id: string;
  email: string;
  phone_number: string;
  api_key: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: 'active' | 'cancelled' | 'none';
  period_start: string | null;
  period_end: string | null;
  minutes_used: number;
  created_at: string;
  enabled: boolean;
}

export interface UsageRecord {
  id: number;
  user_id: string;
  call_id: string;
  duration_seconds: number;
  created_at: string;
}

let db: Database.Database;

export function initDatabase(dbPath?: string): void {
  db = new Database(dbPath || ':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      phone_number TEXT NOT NULL,
      api_key TEXT UNIQUE NOT NULL,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT DEFAULT 'none',
      period_start TEXT,
      period_end TEXT,
      minutes_used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage(user_id);
  `);

  console.error(`Database initialized: ${dbPath || 'in-memory'}`);
}

export function generateApiKey(): string {
  return `sk_${crypto.randomBytes(24).toString('hex')}`;
}

export function generateUserId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// User operations
export function createUser(email: string, phoneNumber: string): User {
  const id = generateUserId();
  const apiKey = generateApiKey();

  const stmt = db.prepare(`
    INSERT INTO users (id, email, phone_number, api_key)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(id, email, phoneNumber, apiKey);
  return getUserById(id)!;
}

export function getUserById(id: string): User | null {
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
  const row = stmt.get(id) as any;
  return row ? rowToUser(row) : null;
}

export function getUserByApiKey(apiKey: string): User | null {
  const stmt = db.prepare('SELECT * FROM users WHERE api_key = ? AND enabled = 1');
  const row = stmt.get(apiKey) as any;
  return row ? rowToUser(row) : null;
}

export function getUserByEmail(email: string): User | null {
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  const row = stmt.get(email) as any;
  return row ? rowToUser(row) : null;
}

export function getUserByStripeCustomerId(customerId: string): User | null {
  const stmt = db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?');
  const row = stmt.get(customerId) as any;
  return row ? rowToUser(row) : null;
}

export function getUserByStripeSubscriptionId(subscriptionId: string): User | null {
  const stmt = db.prepare('SELECT * FROM users WHERE stripe_subscription_id = ?');
  const row = stmt.get(subscriptionId) as any;
  return row ? rowToUser(row) : null;
}

export function updateUserStripeCustomerId(userId: string, customerId: string): void {
  const stmt = db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?');
  stmt.run(customerId, userId);
}

export function updateUserSubscription(
  userId: string,
  subscriptionId: string,
  status: 'active' | 'cancelled' | 'none',
  periodStart: Date,
  periodEnd: Date
): void {
  const stmt = db.prepare(`
    UPDATE users SET
      stripe_subscription_id = ?,
      subscription_status = ?,
      period_start = ?,
      period_end = ?,
      minutes_used = 0
    WHERE id = ?
  `);
  stmt.run(subscriptionId, status, periodStart.toISOString(), periodEnd.toISOString(), userId);
}

export function cancelUserSubscription(userId: string): void {
  const stmt = db.prepare(`UPDATE users SET subscription_status = 'cancelled' WHERE id = ?`);
  stmt.run(userId);
}

export function resetUserMinutes(userId: string, periodStart: Date, periodEnd: Date): void {
  const stmt = db.prepare(`
    UPDATE users SET minutes_used = 0, period_start = ?, period_end = ? WHERE id = ?
  `);
  stmt.run(periodStart.toISOString(), periodEnd.toISOString(), userId);
}

export function addMinutesUsed(userId: string, minutes: number): number {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found');

  const newMinutes = user.minutes_used + minutes;
  const stmt = db.prepare('UPDATE users SET minutes_used = ? WHERE id = ?');
  stmt.run(newMinutes, userId);
  return newMinutes;
}

export function updateUserPhone(userId: string, phoneNumber: string): void {
  const stmt = db.prepare('UPDATE users SET phone_number = ? WHERE id = ?');
  stmt.run(phoneNumber, userId);
}

export function setUserEnabled(userId: string, enabled: boolean): void {
  const stmt = db.prepare('UPDATE users SET enabled = ? WHERE id = ?');
  stmt.run(enabled ? 1 : 0, userId);
}

// Usage operations
export function recordUsage(userId: string, callId: string, durationSeconds: number): void {
  const stmt = db.prepare(`
    INSERT INTO usage (user_id, call_id, duration_seconds)
    VALUES (?, ?, ?)
  `);
  stmt.run(userId, callId, durationSeconds);

  // Add to minutes used (round up)
  const minutes = Math.ceil(durationSeconds / 60);
  addMinutesUsed(userId, minutes);
}

export function getUserUsage(userId: string): { totalCalls: number; totalMinutes: number } {
  const stmt = db.prepare(`
    SELECT
      COUNT(*) as total_calls,
      COALESCE(SUM(duration_seconds), 0) as total_seconds
    FROM usage WHERE user_id = ?
  `);
  const row = stmt.get(userId) as any;

  return {
    totalCalls: row.total_calls,
    totalMinutes: Math.ceil(row.total_seconds / 60),
  };
}

export function getMonthlyUsage(userId: string, periodStart: string): { calls: number; minutes: number } {
  const stmt = db.prepare(`
    SELECT
      COUNT(*) as calls,
      COALESCE(SUM(duration_seconds), 0) as seconds
    FROM usage
    WHERE user_id = ? AND created_at >= ?
  `);
  const row = stmt.get(userId, periodStart) as any;

  return {
    calls: row.calls,
    minutes: Math.ceil(row.seconds / 60),
  };
}

function rowToUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    phone_number: row.phone_number,
    api_key: row.api_key,
    stripe_customer_id: row.stripe_customer_id,
    stripe_subscription_id: row.stripe_subscription_id,
    subscription_status: row.subscription_status || 'none',
    period_start: row.period_start,
    period_end: row.period_end,
    minutes_used: row.minutes_used || 0,
    created_at: row.created_at,
    enabled: Boolean(row.enabled),
  };
}

export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}
