# CivilierERP CORS Fix Task
Status: In Progress

## Approved Plan Breakdown
1. ✅ [Complete] Understand codebase (server.js CORS, vite.config.ts port 8080, users.js login route)
2. ✅ [Complete] Get user approval for plan
3. [Pending] Create TODO.md ✅
4. ✅ Edit backend/server.js:
   - Fix CORS rejection: cb(new Error()) → cb(null, false)
   - Add IPv6 origins: http://[::1]:8080, http://[::1]:3000, etc.
   - Add console.log for origin debugging
5. [Pending] Test login from frontend (/api/users/login)
6. [Pending] Monitor server logs for CORS origin on attempts
7. [Pending] attempt_completion

**Next Step**: Test login in frontend and monitor backend logs for "CORS request from origin" messages.
