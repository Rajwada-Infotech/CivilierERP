# Backend and DB Sanity TODO

This list is ordered by production risk. Fix the red items first, then use `backend/test/sanity.test.js` as the baseline sanity check while expanding coverage.

## Critical

- [ ] Rotate all secrets that were ever stored in `backend/.env`.
  Keep `backend/.env` local-only, confirm it is ignored, and move shared values to `backend/.env.example` without real passwords, JWT secrets, SMTP credentials, or DB credentials.

- [ ] Remove `--passWithNoTests` from `backend/package.json`.
  Current risk: CI can pass even if Jest discovers no backend tests.

- [ ] Fix auth behavior when Redis is down in [backend/middleware/auth.js](middleware/auth.js).
  Current risk: `redisGetStrict()` failure returns `503` for every protected API request. Decide the desired policy, then add tests for Redis-down behavior.

- [ ] Expand transient SQL retry handling in [backend/db.js](db.js).
  Current code retries only `ECONNRESET`. Add `ETIMEDOUT`, `ESOCKET`, connection pool acquire timeout, and common SQL transient network messages.

- [ ] Make document-number generation concurrency-safe.
  Audit every `DocNumberSequence`/next-number query. Use one transaction with `UPDLOCK, HOLDLOCK` or a SQL sequence so two concurrent inserts cannot receive the same number.

- [ ] Stop leaking raw SQL errors from write routes.
  Start with debit note, PO, GRN, payment, material issue/request, and followup write routes. Convert FK/unique/check errors into clear `400` or `409` responses.

## High

- [ ] Add a real DB integration test path.
  Create a separate command such as `npm run test:integration` that requires SQL Server test credentials and verifies migrations, table existence, and one read/write rollback flow.

- [ ] Add migration smoke checks for base auth tables.
  Verify `Users`, `Roles`, `UserRights`, and role mappings exist before migrations that alter or depend on them.

- [ ] Add route smoke tests for all protected route mounts.
  Every `/api/*` route should return `401` with no token and should not throw during app boot.

- [ ] Add happy-path auth tests for login/logout.
  Include bad password, missing user, inactive user if supported, token creation, blacklist write on logout, and Redis failure cases.

- [ ] Add RBAC tests for admin/user/dba/director boundaries.
  Cover `roles`, `user-rights`, `dba`, widgets, page definitions, and approval endpoints.

- [ ] Remove or justify `validate: false` in rate limiter configuration.
  It hides express-rate-limit misconfiguration. Keep only where there is a documented reason.

- [ ] Add explicit cleanup for escalation intervals in [backend/escalationEngine.js](escalationEngine.js).
  Export a stop function and use it in tests and graceful shutdown.

- [ ] Verify GRN total/GST calculations.
  Confirm whether item `totalAmount` already includes GST, then add unit tests for tax-exclusive and tax-inclusive inputs.

- [ ] Normalize duplicate helper code across route files.
  Consolidate repeated helpers such as JSON array parsing and user email/name extraction into `backend/utils`.

## Medium

- [ ] Add validation schema tests for every create/update payload.
  Use invalid IDs, missing required fields, bad dates, negative amounts, empty arrays, and unknown enum values.

- [ ] Add DB transaction tests for multi-table writes.
  PO items, GRN stock ledger, material issues, payments, BRS reconciliation, and followup workflows should rollback fully on failure.

- [ ] Add stock integrity checks.
  Test no negative stock unless explicitly allowed, godown transfer balance, issue against request, and ledger totals.

- [ ] Add approval workflow contract tests.
  Cover unknown modules, no active workflow, level ordering, reject/resubmit, audit log writes, and status transitions.

- [ ] Add dashboard/report tests with safe seed data.
  Focus on “does not crash”, expected shape, and date range filters.

- [ ] Add error response shape consistency.
  Standardize `{ success, error, message, requestId }` or a chosen format across routes and middleware.

- [ ] Add timeout tests for long DB operations.
  Ensure request timeout middleware returns a controlled response and does not write twice.

- [ ] Add startup validation for required env values.
  Fail fast on missing DB/JWT/health/SMTP values where required, but keep test mode mockable.

- [ ] Add Postman/Newman or Supertest coverage for the main ERP workflows.
  Minimum workflows: login, create master, create PO, receive GRN, issue material, payment, approval.

## Low

- [ ] Fix mojibake/comment encoding in backend files.
  Several comments render as garbled characters. Save files as UTF-8 and avoid decorative line characters.

- [ ] Reduce noisy console output in tests.
  Prefer mocked logger and structured assertions.

- [ ] Add API response snapshots only for stable read-only endpoints.
  Avoid snapshots for timestamps, IDs, or large reports.

- [ ] Add a test data factory.
  Keep seed data centralized so integration tests do not copy-paste large payloads.

- [ ] Add CI jobs that run backend unit tests and frontend build separately.
  This makes backend failures easier to diagnose.

- [ ] Add a short backend test README.
  Document unit vs integration commands, required env vars, and how to reset the test DB.

## Commands

Run the sanity suite:

```bash
cd backend
npm test -- --runInBand --testPathPatterns=sanity
```

Run all backend Jest tests:

```bash
cd backend
npm test
```
