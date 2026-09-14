-- Migration 327: "Close Task" page in the Follow-Up sidebar — lists every
-- task with Status = 'Closed' (backend/routes/taskMaster.js GET
-- /closed-board), reachable at /followup/close-tasks.

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'followup-close-tasks', 'Close Task', 'Follow-Up', 'Follow-Up', 'view,export', 20, 1, 'migration-327', SYSDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'followup-close-tasks' AND pd.IsActive = 1
);
GO
