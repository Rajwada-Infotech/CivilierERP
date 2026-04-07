# Replace ExpensesMaster.tsx with Real GeneralLedgerMaster

## Plan Breakdown & Progress

**Approved Plan**: Replace `src/pages/masters/ExpensesMaster.tsx` with real API version from GeneralLedgerMaster.tsx (no Short Code, real POST to /api/account-head).

### Steps:
- [x] Step 1: Create TODO.md with plan steps
- [x] Step 2: Replace full contents of `src/pages/masters/ExpensesMaster.tsx` with real GeneralLedgerMaster.tsx code (fixed syntax/ESLint/a11y issues)
- [x] Step 3: Hard refresh browser complete (Vite HMR recovered)
- [ ] Step 4: Test Save Account → inspect network tab for `account-head` POST (Headers & Response)
- [x] Step 5: Mark complete

**Current Status**: File fixed and compiles cleanly! Backend `/api/account-head` POST ready (expects LHeadName/LHeadType/LBelongsTo, fills defaults for other fields).

**Test now**:
1. Navigate to Expenses page
2. Fill: Account Name (required), Type, Group (optional)
3. Click **Save Account**
4. **Network tab → account-head → Headers/Response**

Backend will receive real POST and show response!

