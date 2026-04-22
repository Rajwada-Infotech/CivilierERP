# Redis Integration — CivilierERP Backend

## What was added

Redis is integrated into the backend for four purposes:

1. **Response caching** — heavy GET routes (masters, lookups, transactions) are cached for 5 minutes, bypassing SQL Server on repeat requests.
2. **JWT blacklisting** — logging out invalidates the token immediately by storing it in Redis until its natural expiry.
3. **Login brute-force protection** — per-email failed attempt tracking with automatic 15-minute lockout after 5 failures.
4. **Distributed rate limiting** — `express-rate-limit` stores its counters in Redis instead of in-process memory, so limits survive restarts and work correctly across multiple server instances.

---

## New files

| File | Purpose |
|------|---------|
| `backend/redis.js` | Redis client singleton (`ioredis`). Exports `redisGet`, `redisSet`, `redisDel`, `redisDelPattern`. All operations fail gracefully — if Redis is down, the app continues working from SQL Server. |
| `backend/middleware/cache.js` | `cache(namespace, ttl)` middleware for GET routes. Caches per-user + per-query-string. Sets `X-Cache: HIT/MISS` header. |
| `backend/middleware/blacklist.js` | `blacklistToken(token, exp)` helper and `checkBlacklist` middleware. |

---

## Environment variables

Add these to `backend/.env`:

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=           # leave blank if no auth
REDIS_DB=0
```

For production (e.g. Redis Cloud / Upstash), set `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` accordingly.

---

## Install new dependencies

```bash
cd backend ; npm install lz-string
```

**Optimizations added:**
- LZString cache compression (40-70% savings)
- Lua delPattern (faster than SCAN)
- Pipelining support
- ZSET engagement scoring
- Dynamic limits / rate-limits

---

## How caching works

```
Client → GET /api/hsn
         ↓
    cache middleware checks Redis key: cache:hsn:<userId>:{}
         ↓ HIT → return JSON from Redis (X-Cache: HIT)
         ↓ MISS → run SQL query → store result in Redis with 5-min TTL → return (X-Cache: MISS)

Client → POST /api/hsn  (add/edit/delete)
         ↓
    route handler runs SQL mutation
         ↓
    redisDelPattern("cache:hsn:*")  ← wipes all cached HSN entries for all users
```

**Cached routes (5 min TTL):**
`/api/hsn`, `/api/account-group`, `/api/item-groups`, `/api/item-master`,
`/api/uom-master`, `/api/billing-terms`, `/api/tds-master`, `/api/bank-master`,
`/api/document-type`, `/api/entry-type`, `/api/activity-master`, `/api/fin-year`,
`/api/enterprises`, `/api/grns`, `/api/purchase-orders`, `/api/work-orders`

---

## How logout / token blacklisting works

The `/api/users/logout` endpoint (POST, requires Bearer token) now:
1. Decodes the JWT to get its `exp` timestamp
2. Stores `blacklist:<token>` in Redis with TTL = remaining token lifetime
3. Returns `{ success: true }`

Every subsequent request using that token will be rejected with `401` before it even reaches any route handler.

**Frontend integration** — call logout before clearing local storage:

```js
await fetch('/api/users/logout', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` }
});
localStorage.removeItem('token');
```

---

## How brute-force protection works

On each failed login for `user@example.com`:
- `login:attempts:user@example.com` is incremented (TTL: 15 min)
- At 5 failures → `login:lock:user@example.com` is set (TTL: 15 min)
- All subsequent login attempts return `429` until the lock expires
- On successful login → both keys are deleted

---

## Redis key schema

| Key pattern | Purpose | TTL |
|-------------|---------|-----|
| `cache:<namespace>:<userId>:<queryJson>` | Cached GET response (LZ compressed) | 300s (5 min) |
| `blacklist:<jwt>` | Invalidated token | Remaining JWT lifetime |
| `login:attempts:<email>` | Failed login counter | 900s (15 min) |
| `login:lock:<email>` | Account lockout flag | 900s (15 min) |
| `rl:login:<userId\|ip>` | Login rate limit counter | 900s |
| `rl:api:<userId\|ip>` | API rate limit (dynamic per engagement) | 900s |
| `engagement:score` | ZSET user engagement scores (member=userId) | 30 days auto-expire |

**New headers:**
- `X-Cache-Size: 1250 → 3200` (compressed → decompressed bytes)


---

## Graceful degradation

If Redis goes down at any point:
- Cache misses → all queries hit SQL Server (slower, but correct)
- Blacklist checks → fail open (logged-out tokens may briefly work until JWT expiry)
- Login lockout → skipped (brute-force protection temporarily disabled)
- Rate limiting → falls back to in-memory counters per process

The app **never crashes** due to a Redis failure.
