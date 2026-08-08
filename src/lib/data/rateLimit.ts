import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "./collections";

// Hive calls cost real money per check - this is what actually caps
// exposure, not just abuse prevention. Configurable per environment
// without a redeploy of the limit itself.
const DEFAULT_DAILY_LIMIT = 10;

// A backstop, not a normal-usage ceiling: per-IP limiting alone doesn't
// stop a distributed abuser rotating IPs from running up real Hive spend.
// This is deliberately high relative to today's real traffic (a handful of
// requests/day) - if it ever actually trips, that itself is the signal
// something is wrong, on top of the budget alert (infra/budget.tf) and
// uptime/monitoring already in place.
const DEFAULT_GLOBAL_DAILY_LIMIT = 500;

function getLimit(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

/**
 * Atomically checks and (if allowed) consumes one slot against a counter
 * doc. A transaction, not a read-then-write, so two concurrent requests
 * can't both slip through at the last slot.
 */
async function consumeCounter(
  docRef: FirebaseFirestore.DocumentReference,
  limit: number,
): Promise<RateLimitResult> {
  const db = getAdminDb();
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    const count = (snapshot.data()?.count as number | undefined) ?? 0;

    if (count >= limit) {
      return { allowed: false, remaining: 0, limit };
    }

    const newCount = count + 1;
    transaction.set(docRef, { count: newCount, updatedAt: new Date().toISOString() });
    return { allowed: true, remaining: limit - newCount, limit };
  });
}

export async function checkAndConsumeRateLimit(ip: string): Promise<RateLimitResult> {
  const limit = getLimit("DAILY_CHECK_LIMIT", DEFAULT_DAILY_LIMIT);
  const docRef = getAdminDb().collection(COLLECTIONS.RATE_LIMITS).doc(`${ip}_${todayKey()}`);
  return consumeCounter(docRef, limit);
}

/** Global, IP-agnostic circuit breaker - see DEFAULT_GLOBAL_DAILY_LIMIT. */
export async function checkAndConsumeGlobalRateLimit(): Promise<RateLimitResult> {
  const limit = getLimit("GLOBAL_DAILY_CHECK_LIMIT", DEFAULT_GLOBAL_DAILY_LIMIT);
  const docRef = getAdminDb().collection(COLLECTIONS.GLOBAL_RATE_LIMIT).doc(todayKey());
  return consumeCounter(docRef, limit);
}
