-- Migration 675: Civil Work DPR > Reporting gets a Delete action in Menu Rights.
--
-- Deleting an activity photo or a checkpoint's daily update had only a sign-in check, so anyone signed in could
-- do it, whatever their rights (Reporting only offered view / edit, so there was no Delete to untick). The server
-- now requires Delete on Reporting or Work Done for those; this adds the Delete tick box on Reporting so roles
-- that should be able to delete can be given it. No role gets it here — grant it in Menu Rights.

UPDATE dbo.PageDefinitions
SET Actions = Actions + ',delete'
WHERE PageKey = 'civilworkdpr-activity-reporting' AND IsActive = 1
  AND (',' + REPLACE(Actions, ' ', '') + ',') NOT LIKE '%,delete,%';
GO

PRINT '675-dpr-reporting-delete-right applied successfully.';
GO
