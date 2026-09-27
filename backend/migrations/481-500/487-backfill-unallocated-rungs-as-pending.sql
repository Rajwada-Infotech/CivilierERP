-- Migration 487: an activity rung that's never been opened in Work
-- Allocation had no row in dbo.DependencyActivityAssignment at all, so it
-- was invisible to Work Reporting's own Pending count — Work Allocation's
-- "Dependency Chains" browser showed it labeled Pending (a client-side
-- default for "no assignment yet"), but Reporting's Pending tile only
-- counts real assignment rows sitting at Status='PENDING', so the two
-- disagreed. Per explicit instruction, a never-allocated rung genuinely IS
-- a pending one — so give every rung a real stub assignment row up front
-- (Status='PENDING', nothing else set) instead of only creating one the
-- first time someone saves an engineer/material against it. This is a
-- one-time backfill for rungs that already existed before this change;
-- dependencyMaster.js now inserts this same stub row at the moment a rung
-- itself is created, so the gap can't reopen for new chains.
INSERT INTO dbo.DependencyActivityAssignment (DependencyMasterActivityId, CreatedBy)
SELECT dma.Id, 'migration-487'
FROM dbo.DependencyMasterActivity dma
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.DependencyActivityAssignment daa WHERE daa.DependencyMasterActivityId = dma.Id
);
GO

PRINT '487-backfill-unallocated-rungs-as-pending applied successfully.';
GO
