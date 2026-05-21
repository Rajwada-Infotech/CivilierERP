# Implementation Plan

[Overview]
Harden and simplify the activity and follow-up applicant endpoints by addressing SQL safety, timezone-correct filtering, and consistency between backend events and frontend expectations.

This project currently provides two important backend areas:
- `backend/routes/userActivity.js`: paginated querying + real-time socket broadcasting for `UserActivityLog`.
- `backend/routes/followupApplicants.js`: CRUD APIs over `dbo.FollowupApplicants` with soft delete and dependency checks.

The code is functional, but there are several high-risk and maintenance issues:
- Potential SQL fragility around dynamic `ORDER BY` composition.
- Date range filtering (`period` presets) mixes UTC-derived strings with server-local `Date` objects, which can shift results by a day.
- `followupApplicants` lacks explicit role/permission checks (it only authenticates), which may be unsafe depending on what `authMiddleware` enforces.
- Socket payload shape should be confirmed against the frontend `ActivityBrowserContext` normalization logic.

The implementation will focus on small, targeted changes that reduce risk without redesigning core behavior.

[Types]  
Introduce explicit type-safe mappings/whitelists for `sortField`/`order` values used in SQL construction, and align backend event payload fields with the existing `SessionEvent` shape.

Type definitions (conceptual, JS/TS boundary):
- Backend (JS): create constant maps:
  - `SORT_FIELD_MAP: Record<string, 'UserName'|'EventType'|'CreatedAt'>`
  - `ORDER_MAP: Record<string, 'ASC'|'DESC'>`
  - Use these maps to guarantee no unexpected values reach SQL.
- Frontend (TS): no new types required, but confirm that emitted socket fields match `SessionEvent` and that `ActivityBrowserContext.normalizeEvent()` can safely normalize them.

Validation rules:
- For `GET /api/user-activity` (userActivity route), allow only whitelisted `sort` values and force `order` to be either ASC/DESC.
- For `GET /api/user-activity` date filters, compute `dateFrom`/`dateTo` consistently in the same timezone basis (UTC or local) and pass explicit `Date` objects to SQL parameters.

[Files]
Modify `backend/routes/userActivity.js`, optionally add a small helper module for date+sort normalization, and update any frontend contract mismatch only if discovered during alignment.

Detailed file changes:
- Modify:
  - `backend/routes/userActivity.js`
    - Replace fragile `ORDER BY ${sortColumn} ${order}` with explicit whitelisting.
    - Rework `period` -> `computedDateFrom/computedDateTo` so it uses a single timezone basis.
    - Ensure query parameter names and values are consistent with computed boundaries.
- Optionally add:
  - `backend/utils/userActivityQueryHelpers.js` (if you want to keep the route lean)
    - Exports: `getSortSql(sort, order)`, `computeDateRange(period, dateFrom, dateTo)`
- Verify:
  - `src/contexts/ActivityBrowserContext.tsx` and `src/api/userActivityApi.ts`
    - If any field naming mismatch exists between backend emitted `activity:new` payload and frontend `SessionEvent` expectations, adjust backend emit fields accordingly.

[Functions]
Update the GET activity query handler to make sorting and date filtering deterministic and safe.

Detailed breakdown:
- Modified functions:
  - In `backend/routes/userActivity.js`:
    - The handler for `router.get('/', checkPermission(...), cache(...), async (req, res) => { ... })`
      - Change how `sortColumn` and `order` are derived (use maps/whitelists).
      - Change `period` computation to consistently generate correct `dateFrom/dateTo` boundaries.
      - Keep all SQL parameters parameterized (no interpolated user input except validated column names).
  - No changes required for `mapActivityRow`, `router.get('/session/:sessionId')`, or `router.post('/')` unless alignment work reveals a payload mismatch.

[Classes]
No class changes.

[Dependencies]
No dependency additions required.

[Testing]
Use targeted manual tests (and add lightweight automated tests only if the repo already has a test harness for routes).

Testing plan:
- Backend GET `/api/user-activity`:
  - Verify `sort=userName|event|timestamp` and `order=asc|desc` produce correct SQL results.
  - Verify `period` presets around midnight/day boundaries (run tests with known timestamps).
  - Verify `search`, `event`, and `role` filters still work.
- Backend POST `/api/user-activity`:
  - Verify response structure unchanged.
  - Verify Redis engagement bump still occurs only for allowed `actionType` values.
  - Verify socket emit still broadcasts `activity:new` with fields the frontend can normalize.
- Frontend `ActivityBrowserContext`:
  - Confirm that new socket events appear immediately and grouping/pagination remains consistent after re-fetch.

[Implementation Order]
Perform changes in a sequence that preserves behavior and minimizes regression risk.

1. Inspect how the frontend calls `getUserActivityLogs` and what query params it sends (confirm `sort`/`order`/`period` names).
2. Implement sort/order whitelisting in `backend/routes/userActivity.js` and add regression checks.
3. Implement deterministic date boundary computation for `period` and validate with manual tests for edge dates.
4. Cross-check socket payload fields from `POST /api/user-activity` against `SessionEvent` normalization in `ActivityBrowserContext.tsx`.
5. Run app (and any existing backend lint/tests) to ensure no runtime errors.


