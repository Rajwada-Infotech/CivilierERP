-- Migration 333: PageDefinitions row for the Entry Type & Document
-- Follow-Up Report (backend/routes/entryTypeDocFollowUpReport.js,
-- src/pages/followup/EntryTypeDocFollowUpReport.tsx). Read-only report.

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'entry-type-doc-followup-report', 'Entry Type & Document Follow-Up Report', 'Follow-Up', 'Follow-Up', 'view', 7, 1, 'migration-333', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'entry-type-doc-followup-report' AND pd.IsActive = 1
);
GO
