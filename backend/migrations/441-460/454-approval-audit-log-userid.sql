-- Migration 454: ApprovalAuditLog gains a UserId column.
-- Needed for real per-level "everyone must approve" enforcement — before
-- this, only ApproverEmail identified who acted, which is fragile to match
-- against LevelDefs.userIds (numeric dbo.users.id values). Nullable/
-- backward-compatible: existing rows and any caller that doesn't pass a
-- userId keep working exactly as before.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ApprovalAuditLog') AND name = 'UserId')
  ALTER TABLE dbo.ApprovalAuditLog ADD UserId INT NULL;
GO

PRINT '454-approval-audit-log-userid applied successfully.';
GO
