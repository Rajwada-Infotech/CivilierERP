-- Migration 279: Final sweep — diffed every pageKey referenced by a
-- <ProtectedRoute> in App.tsx against dbo.PageDefinitions and found 3 more
-- real pages with zero row (so Menu Rights could never grant them to a
-- non-privileged role — only the PAGE_DEFINITIONS fallback in
-- contexts/auth.utils.ts, used purely to derive super_admin/admin/dba's
-- automatic FULL_ACCESS, ever "knew" about them). None of these three have
-- a sidebar link anywhere either — reachable only by direct URL today.
--
-- (A 4th, "account-group", turned out to be the same route/internal-check
-- mismatch bug found repeatedly this pass — AccountGroupMaster.tsx's own
-- usePageRights() call and the sidebar both already use "account-head",
-- which already has a row; only the route's ProtectedRoute pageKey was
-- wrong. Fixed directly in App.tsx, no DB insert needed for it.)

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
VALUES
  ('transactions', 'Transactions', 'Finance', 'Finance', 'view,create,edit,delete,print,export', 25, 1, 'migration-279', SYSUTCDATETIME()),
  ('on-account-report', 'On A/C Report', 'Finance', 'Finance', 'view,print,export', 35, 1, 'migration-279', SYSUTCDATETIME()),
  ('payment-plan-master', 'Payment Plan Master', 'CRM', 'CRM Setup', 'view,create,edit,delete', 170, 1, 'migration-279', SYSUTCDATETIME());
GO
