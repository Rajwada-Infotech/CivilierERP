/* ============================================================================
   Employee Master — "only one employee could be saved" fix (same as migration 662).
   Run this ONCE on every other database (staging / live) in SSMS, with the CivilierERP database selected.
   Safe to run again: each step checks first. It changes no employee data.

   Problem: EmployeeMaster.CandidateId had a plain UNIQUE constraint. SQL Server counts NULL as a value in a unique
   constraint, so only ONE employee without a recruitment candidate could ever be saved; the next ones failed with
   "This candidate has already been added as an employee" (and the screen showed a row that was never stored).

   Fix: keep "a candidate becomes at most one employee", but only for rows that HAVE a candidate (filtered unique index).
   ============================================================================ */

SET NOCOUNT ON;

PRINT '--- BEFORE ---';
SELECT i.name AS IndexName, i.is_unique_constraint AS IsConstraint, i.filter_definition AS FilterDefinition
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('dbo.EmployeeMaster') AND i.name = 'UQ_EmployeeMaster_CandidateId';

-- Safety check: the filtered index needs every non-NULL CandidateId to be unique. The old constraint already guaranteed
-- that, so this should return no rows; if it does return rows, fix those duplicates first.
IF EXISTS (SELECT 1 FROM dbo.EmployeeMaster WHERE CandidateId IS NOT NULL GROUP BY CandidateId HAVING COUNT(*) > 1)
BEGIN
  PRINT 'STOP: these CandidateIds are used by more than one employee — resolve them, then run this script again.';
  SELECT CandidateId, COUNT(*) AS Employees FROM dbo.EmployeeMaster
  WHERE CandidateId IS NOT NULL GROUP BY CandidateId HAVING COUNT(*) > 1;
  RETURN;
END

-- 1) Drop the plain UNIQUE constraint (if it is still there).
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_EmployeeMaster_CandidateId' AND parent_object_id = OBJECT_ID('dbo.EmployeeMaster'))
BEGIN
  ALTER TABLE dbo.EmployeeMaster DROP CONSTRAINT UQ_EmployeeMaster_CandidateId;
  PRINT 'Dropped the plain UNIQUE constraint UQ_EmployeeMaster_CandidateId.';
END

-- 2) Create the filtered unique index (candidate rows only).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_EmployeeMaster_CandidateId' AND object_id = OBJECT_ID('dbo.EmployeeMaster'))
BEGIN
  CREATE UNIQUE INDEX UQ_EmployeeMaster_CandidateId ON dbo.EmployeeMaster (CandidateId) WHERE CandidateId IS NOT NULL;
  PRINT 'Created filtered unique index UQ_EmployeeMaster_CandidateId.';
END

-- 3) Tell the migration runner this change is already applied, so "node migrate.js up" doesn't repeat it.
--    (Only if the runner's table exists on this database; harmless otherwise.)
IF OBJECT_ID('dbo.__Migrations') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.__Migrations WHERE name = '662-employee-candidate-unique-filtered.sql')
BEGIN
  BEGIN TRY
    INSERT INTO dbo.__Migrations (name, applied_at) VALUES ('662-employee-candidate-unique-filtered.sql', SYSUTCDATETIME());
    PRINT 'Recorded migration 662 as applied.';
  END TRY
  BEGIN CATCH
    PRINT 'Note: could not record migration 662 in dbo.__Migrations (' + ERROR_MESSAGE() + ') — run "node migrate.js up" instead if you prefer.';
  END CATCH
END

PRINT '--- AFTER ---';
SELECT i.name AS IndexName, i.is_unique AS IsUnique, i.filter_definition AS FilterDefinition   -- expect: ([CandidateId] IS NOT NULL)
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('dbo.EmployeeMaster') AND i.name = 'UQ_EmployeeMaster_CandidateId';

-- Employees saved so far (rows that failed earlier were never stored, so there is nothing to repair here —
-- just add them again from the Employee Master screen).
SELECT COUNT(*) AS EmployeesInMaster,
       SUM(CASE WHEN CandidateId IS NULL THEN 1 ELSE 0 END) AS WithoutCandidate
FROM dbo.EmployeeMaster;
