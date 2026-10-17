/**
 * Redis-backed express-session store.
 *
 * The default MemoryStore loses every session when the API restarts, which on
 * a hosted deploy signs everyone out on each deploy or spin-down. Sessions are
 * kept in Redis instead, under `<prefix><sid>`, expiring with the cookie.
 */
import session, { type SessionData } from 'express-session';
import { Redis } from 'ioredis';

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

type Callback = (err?: unknown) => void;

export class RedisSessionStore extends session.Store {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'reachinbox:sess:'
  ) {
    super();
  }

  private key(sid: string): string {
    return `${this.prefix}${sid}`;
  }

  private ttlSeconds(sess: SessionData): number {
    const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : NaN;
    if (Number.isFinite(expires)) {
      return Math.max(1, Math.ceil((expires - Date.now()) / 1000));
    }
    return DEFAULT_TTL_SECONDS;
  }

  override get(sid: string, cb: (err: unknown, sess?: SessionData | null) => void): void {
    this.redis
      .get(this.key(sid))
      .then((raw) => cb(null, raw ? (JSON.parse(raw) as SessionData) : null))
      .catch((err) => cb(err));
  }

  override set(sid: string, sess: SessionData, cb?: Callback): void {
    this.redis
      .set(this.key(sid), JSON.stringify(sess), 'EX', this.ttlSeconds(sess))
      .then(() => cb?.())
      .catch((err) => cb?.(err));
  }

  override touch(sid: string, sess: SessionData, cb?: Callback): void {
    this.redis
      .expire(this.key(sid), this.ttlSeconds(sess))
      .then(() => cb?.())
      .catch((err) => cb?.(err));
  }

  override destroy(sid: string, cb?: Callback): void {
    this.redis
      .del(this.key(sid))
      .then(() => cb?.())
      .catch((err) => cb?.(err));
  }
}

/**
 * Builds the session store on its own Redis connection. The shared client is
 * tuned for fail-fast health checks and never reconnects, which would sign
 * everyone out after one Redis blip; this one keeps reconnecting.
 */
export function createRedisSessionStore(redisUrl: string): RedisSessionStore {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  redis.on('error', (err: Error) => {
    console.error('[Session Store Redis Error]', err.message);
  });
  return new RedisSessionStore(redis);
}
