export function createAuthRateLimiter({
  consumeAuthRateLimit,
  clearExpiredAuthRateLimits,
  sendError,
  defaultMaxAttempts,
  defaultWindowMs,
  cleanupIntervalMs = 60_000,
}) {
  const authRateCleanup = setInterval(() => {
    clearExpiredAuthRateLimits(Date.now());
  }, cleanupIntervalMs);

  if (typeof authRateCleanup.unref === 'function') {
    authRateCleanup.unref();
  }

  return function rateLimitAuth({
    keyPrefix,
    maxAttempts = defaultMaxAttempts,
    windowMs = defaultWindowMs,
  }) {
    return (req, res, next) => {
      const email =
        typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
      const key = `${keyPrefix}:${req.ip}:${email}`;
      const result = consumeAuthRateLimit({
        key,
        nowMs: Date.now(),
        windowMs,
        maxAttempts,
      });

      if (!result.allowed) {
        res.setHeader('Retry-After', String(Math.max(1, result.retryAfterSeconds ?? 1)));
        sendError(res, 429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
        return;
      }

      next();
    };
  };
}
