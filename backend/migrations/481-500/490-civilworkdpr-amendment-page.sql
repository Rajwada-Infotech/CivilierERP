-- Migration 490: Civil Work DPR > Amendment — a read-only log of every
-- reworked activity attempt (see migration 488's fork-on-rework design).
-- Lists every superseded assignment row (IsCurrent = 0), each one a past
-- attempt that got sent back — via QC or an Approval rejection — before
-- the current attempt replaced it.
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'civilworkdpr-amendment', 'Amendment', 'Civil Work DPR', 'Civil Work DPR', 'view,export', 16, 1, 'migration-490', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'civilworkdpr-amendment' AND pd.IsActive = 1
);
GO

PRINT '490-civilworkdpr-amendment-page applied successfully.';
GO
