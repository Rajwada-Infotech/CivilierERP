# Redis Architecture Optimization & Dynamic Limits TODO

Current progress: 6/8 steps complete.

6. **[COMPLETE]** Update backend/REDIS.md docs - Added engagement ZSET, dynamic limits/rates, compression headers, Lua del ✅

1. **[COMPLETE]** Install dependencies [...] ✅

2. **[COMPLETE]** Update backend/redis.js [...] ✅

3. **[COMPLETE]** Update backend/routes/userActivity.js [...] ✅

4. **[COMPLETE]** Update backend/middleware/cache.js [...] ✅

5. **[COMPLETE]** Update backend/server.js
   - Dynamic apiLimiter max: 50 + (score/10), capped 500 per user
   - keyGenerator per-user-ID first ✅

## Next: Step 6 - REDIS.md docs update.

1. **[PENDING]** Install dependencies: `cd backend ; npm install lz-string`

2. **[PENDING]** Update backend/redis.js
   - Add lz-string compression helpers
   - Add pipelineExec(commands)
   - Add Lua deleteByPattern
   - Add zscore, zincrby helpers for engagement ZSET

3. **[PENDING]** Update backend/routes/userActivity.js
   - POST: weighted zincrby based on actionType (read=1, create=10, update=8, delete=15, export=5, default=2)
   - GET: fetch score, dynamicDefault = getDynamicLimit(score)
     tiers: <20→20, <100→50, <300→100, <1000→200, →300
   - limit = min(query.limit || dynamicDefault, 1000)

4. **[PENDING]** Update backend/middleware/cache.js
   - Support compress: true (lz compress/decompress)
   - X-Cache-Size header

5. **[PENDING]** Update backend/server.js
   - Dynamic apiLimiter max based on user engagement score

6. **[PENDING]** Update backend/REDIS.md docs

7. **[PENDING]** Test:
   - POST multiple activities → GET no-limit → expect increasing defaults
   - Cache routes → check compression headers
   - Mutations → verify Lua delPattern

8. **[PENDING]** attempt_completion

Updated when steps complete.

