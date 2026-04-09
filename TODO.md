# Fix GeneralLedgerMaster - Show only GL data after add/edit/delete

## Steps:
1. [x] Update GeneralLedgerMaster.tsx: Add GL_TYPE="GL", fix queryKey/queryFn to getList(GL_TYPE), update mutations to pass GL_TYPE, fix invalidateQueries(["account-head", GL_TYPE])
2. [x] Test: npm run dev, go to /masters/general-ledger, add ledger head → verify ONLY GL data shows (no Suppliers/Contractors/Customers)
3. [ ] Optional: Fix ExpensesMaster similarly
4. [ ] Complete task ✓

**Current:** Plan approved, GL_TYPE="GL". Edits next.

