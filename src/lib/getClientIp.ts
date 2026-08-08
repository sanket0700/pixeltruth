import "server-only";

// Cloud Run's front-end proxy sets x-forwarded-for itself and is the only
// hop in front of the app, so the first (leftmost) address is the real
// client - not attacker-controlled the way it would be behind an arbitrary
// chain of proxies.
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || "unknown";
}
