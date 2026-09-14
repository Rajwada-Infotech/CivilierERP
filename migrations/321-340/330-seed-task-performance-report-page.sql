-- Migration 330: PageDefinitions row for the new Task Performance Report
-- (backend/routes/taskPerformanceReport.js, src/pages/followup/TaskPerformanceReport.tsx).
-- Read-only report — view only, no create/edit/delete actions.

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'task-performance-report', 'Task Performance Report', 'Follow-Up', 'Follow-Up', 'view', 4, 1, 'migration-330', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'task-performance-report' AND pd.IsActive = 1
);
GO
