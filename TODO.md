# TODO - Login 401 investigation

- [ ] Step 1: Confirm frontend is calling `/api/users/login` with correct body fields (email/password) and correct backend URL/proxy.
- [ ] Step 2: Inspect backend auth error paths: `/api/users/login` route should return 401 for invalid credentials; verify why request gets 401.
- [ ] Step 3: Verify DB query uses `u.email` and reads `u.password` hashed; confirm frontend sends plain password.
- [ ] Step 4: Check environment variables on backend: `JWT_SECRET` presence; confirm server not failing and returning 500.
- [ ] Step 5: (If still 401) Add temporary structured logging in backend login route for user lookup success (not password) and respond with safe debug info in dev.
- [ ] Step 6: Run backend tests (if available) and/or simulate login request with known credentials to validate route.

