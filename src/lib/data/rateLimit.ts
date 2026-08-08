import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "./collections";

// Hive calls cost real money per check - this is what actually caps
// exposure, not just abuse prevention. Configurable per environment
// without a redeploy of the limit itself.
const DEFAULT_DAILY_LIMIT = 10;

function getDailyLimit(): number {
  const raw = process.env.DAILY_CHECK_LIMIT;
  if (!raw) return DEFAULT_DAILY_LIMIT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_LIMIT;
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
 * Atomically checks and (if allowed) consumes one of the caller's daily
 * checks. A transaction, not a read-then-write, so two concurrent requests
 * from the same IP can't both slip through at the last slot.
 */
export async function checkAndConsumeRateLimit(ip: string): Promise<RateLimitResult> {
  const limit = getDailyLimit();
  const db = getAdminDb();
  const docRef = db.collection(COLLECTIONS.RATE_LIMITS).doc(`${ip}_${todayKey()}`);

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
