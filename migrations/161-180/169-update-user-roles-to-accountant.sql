-- Migration 169: Update users Mainab (11), Rohit (12), Kasturi (13), Rani (14), Rima (16)
-- from role='user' to role='Accountant' (same role Kuntal uses, RId=4).
-- Updates both RoleId FK and the legacy role string (synced from dbo.Role.RName).
-- Idempotent: guard on role string to skip rows already on the correct role.

DECLARE @AccountantRoleId INT;
SELECT @AccountantRoleId = RId FROM dbo.Role WHERE RName = 'Accountant';

IF @AccountantRoleId IS NULL
BEGIN
    RAISERROR('Accountant role not found in dbo.Role — aborting migration 169', 16, 1);
    RETURN;
END

UPDATE dbo.users
SET    RoleId = @AccountantRoleId,
       role   = (SELECT RName FROM dbo.Role WHERE RId = @AccountantRoleId)
WHERE  id IN (11, 12, 13, 14, 16)
  AND  (RoleId != @AccountantRoleId OR RoleId IS NULL);

PRINT CONCAT('Migration 169 complete — rows updated: ', @@ROWCOUNT);
