-- ============================================================
-- Migration 379 -- CrmNoc: unique active NOC per booking per type
-- ============================================================
-- Problem: POST /api/crm/noc had no duplicate guard. A fast double-click
-- (or concurrent submit) could create two Pending rows with different NocNo
-- values for the same (BookingId, NocType). crmLegalMilestones.js's TOP 1
-- per-type display would then show whichever was created LAST (likely still
-- Pending) instead of the real Issued one -- staff see "Bank NOC: Pending"
-- on the tracker while the first-created Bank NOC is actually Issued.
--
-- Fix: filtered unique index on (BookingId, NocType) WHERE Status <> 'Rejected'.
-- Rejected NOCs are excluded: the resubmit path (PUT /:id/submit) reuses the
-- existing Rejected row (approvalTransition Rejected -> Pending on the same row)
-- so there is never a second INSERT for a resubmitted NOC.
--
-- An app-layer 409 pre-check was also added to POST / (same session) so staff
-- get a clear message before hitting this constraint.
-- ============================================================

-- Pre-flight: show any existing duplicates that would block index creation.
-- Run this SELECT first; if it returns rows, deduplicate manually before
-- running the CREATE INDEX below.
SELECT BookingId, NocType, COUNT(*) AS DuplicateCount,
       STRING_AGG(CAST(Id AS NVARCHAR(10)) + ' ' + Status, ', ') AS Rows
FROM dbo.CrmNoc
WHERE Status <> 'Rejected'
GROUP BY BookingId, NocType
HAVING COUNT(*) > 1;

-- Create the filtered unique index.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CrmNoc') AND name = 'UQ_CrmNoc_ActiveNocPerType'
)
BEGIN
  CREATE UNIQUE INDEX UQ_CrmNoc_ActiveNocPerType
    ON dbo.CrmNoc (BookingId, NocType)
    WHERE Status <> 'Rejected';
  PRINT 'Created UQ_CrmNoc_ActiveNocPerType on dbo.CrmNoc';
END
ELSE
BEGIN
  PRINT 'UQ_CrmNoc_ActiveNocPerType already exists -- skipping';
END
