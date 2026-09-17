import "server-only";

type Bucket = { hits: number[]; blockedUntil?: number };

const buckets = new Map<string, Bucket>();

/**
 * Small in-memory sliding-window limiter. Enough to blunt password guessing on a
 * single instance; move to Redis or the database if the app scales out further.
 */
export function rateLimit(key: string, { limit, windowMs, blockMs }: { limit: number; windowMs: number; blockMs: number }) {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };

  if (bucket.blockedUntil && bucket.blockedUntil > now) {
    return { allowed: false as const, retryAfterSeconds: Math.ceil((bucket.blockedUntil - now) / 1000) };
  }

  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  bucket.hits.push(now);

  if (bucket.hits.length > limit) {
    bucket.blockedUntil = now + blockMs;
    bucket.hits = [];
    buckets.set(key, bucket);
    return { allowed: false as const, retryAfterSeconds: Math.ceil(blockMs / 1000) };
  }

  bucket.blockedUntil = undefined;
  buckets.set(key, bucket);

  // Keep the map from growing without bound on a long-running instance.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (!v.blockedUntil && (v.hits.at(-1) ?? 0) < now - windowMs) buckets.delete(k);
    }
  }

  return { allowed: true as const, retryAfterSeconds: 0 };
}
