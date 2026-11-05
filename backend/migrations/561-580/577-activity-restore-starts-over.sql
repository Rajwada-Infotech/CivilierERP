-- Migration 577: restoring a Cancelled activity starts it over.
--
-- Restore used to flip a Cancelled activity straight back to In Progress with
-- its old Work Done still on the bar, so it could neither go back to Allocated
-- nor be reported from zero. It now forks a fresh attempt, the same way rework
-- does: the cancelled attempt is kept as history and the new one sits at
-- Allocated with the bar at 0. That superseded attempt is marked
-- ReworkSource = 'RESTORE', so the source check has to allow it.
-- Safe to run again.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DependencyActivityAssignment_ReworkSource')
  ALTER TABLE dbo.DependencyActivityAssignment DROP CONSTRAINT CK_DependencyActivityAssignment_ReworkSource;
GO

ALTER TABLE dbo.DependencyActivityAssignment
  ADD CONSTRAINT CK_DependencyActivityAssignment_ReworkSource CHECK (ReworkSource IN ('QC', 'APPROVAL', 'RESTORE'));
GO
