# Fix getOverdueTasks Error in Dashboard

## Steps

- [x] 1. Add missing `getOverdueTasks` and `getDueSoonTasks` to TaskContext.tsx
- [ ] 2. Test Dashboard.tsx loads without error  
- [ ] 3. Verify FollowupDashboard.tsx also works
- [ ] 4. Clean up redundant calculations in Dashboard.tsx (optional)
- [ ] 5. Complete

**Status:** TaskContext ✅ fixed with date-filtering helpers. Refresh/restart dev server (`npm run dev`) and navigate to Dashboard to confirm \"getOverdueTasks is not a function\" error resolved. FollowupDashboard.tsx also fixed automatically.
