# TODO.md

- [ ] Update backend/routes/debitNote.js GET query:
  - Remove invalid `u.role_name AS created_by_role`
  - Use safe select with `u.RoleId AS created_by_role_id` (or just `u.RoleId`) to avoid 500
- [ ] Ensure frontend expectation (field name) matches backend response
- [ ] Restart backend and verify:
  - `GET /api/debit-note` returns 200
  - `/masters/debit-note` loads
- [ ] After query works, investigate `retryer.ts` spam and disable retries for this failing query

