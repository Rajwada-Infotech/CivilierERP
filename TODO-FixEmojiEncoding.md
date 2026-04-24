# Fix Emoji Encoding in Backend Logs

## Problem
Windows terminal renders UTF-8 emojis as garbled characters (e.g., `≡ƒöî` instead of `🔌`).

## Solution
Replace all emoji and box-drawing characters with ASCII-safe alternatives.

## Files Edited
- [x] backend/server.js
- [x] backend/requestLogger.js
- [x] backend/utils/loadRoutes.js
- [x] backend/middleware/permissions.js
- [x] backend/fix-passwords.js

## Verification
Run `npm run dev` in the backend folder — all log output should now be clean ASCII.

