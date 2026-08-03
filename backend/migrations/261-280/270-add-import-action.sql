-- Migration 271: adds the "import" action to the two pages that actually
-- have a CSV Import button in the UI (Task Master, Department Master).
-- Actions is a plain CSV string column — appending here, not replacing, so
-- any other already-granted actions on these pages are untouched.

UPDATE dbo.PageDefinitions
SET Actions = Actions + ',import'
WHERE PageKey IN ('task-master', 'followup-department-master')
  AND CHARINDEX('import', Actions) = 0;
GO
