import { afterEach, describe, expect, it } from "vitest";
import { checkAndConsumeRateLimit } from "../rateLimit";

let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

describe("checkAndConsumeRateLimit", () => {
  afterEach(() => {
    delete process.env.DAILY_CHECK_LIMIT;
  });

  it("allows requests up to the limit, then blocks", async () => {
    process.env.DAILY_CHECK_LIMIT = "3";
    const ip = uniqueIp();

    expect(await checkAndConsumeRateLimit(ip)).toEqual({ allowed: true, remaining: 2, limit: 3 });
    expect(await checkAndConsumeRateLimit(ip)).toEqual({ allowed: true, remaining: 1, limit: 3 });
    expect(await checkAndConsumeRateLimit(ip)).toEqual({ allowed: true, remaining: 0, limit: 3 });
    expect(await checkAndConsumeRateLimit(ip)).toEqual({ allowed: false, remaining: 0, limit: 3 });
  });

  it("tracks separate IPs independently", async () => {
    process.env.DAILY_CHECK_LIMIT = "1";
    const ipA = uniqueIp();
    const ipB = uniqueIp();

    expect((await checkAndConsumeRateLimit(ipA)).allowed).toBe(true);
    expect((await checkAndConsumeRateLimit(ipA)).allowed).toBe(false);
    expect((await checkAndConsumeRateLimit(ipB)).allowed).toBe(true);
  });

  it("never lets a concurrent burst exceed the limit (transactional, not read-then-write)", async () => {
    process.env.DAILY_CHECK_LIMIT = "3";
    const ip = uniqueIp();

    const results = await Promise.all(Array.from({ length: 8 }, () => checkAndConsumeRateLimit(ip)));
    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(3);
  });

  it("falls back to the default limit when DAILY_CHECK_LIMIT is unset or invalid", async () => {
    delete process.env.DAILY_CHECK_LIMIT;
    const ip = uniqueIp();
    expect((await checkAndConsumeRateLimit(ip)).limit).toBe(10);

    process.env.DAILY_CHECK_LIMIT = "not-a-number";
    const ip2 = uniqueIp();
    expect((await checkAndConsumeRateLimit(ip2)).limit).toBe(10);
  });
});
