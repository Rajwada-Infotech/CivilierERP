-- Migration 389: DB-level backstop against double-selling a Unit.
--
-- Audit context (CivilierERP CRM Deep QA Audit, Finding #4 / XCT-007): the
-- Hold table has a filtered unique index (UQ_CrmInventoryHold_ActiveEntity)
-- as its real concurrency backstop, on top of the application-layer
-- assertEntityNotTaken()/findActiveHold() checks — but no equivalent
-- constraint exists on CrmBooking itself, so two direct-booking requests
-- for the same Unit that both bypass the hold step could both pass the
-- app-layer "not taken" check before either commits.
--
-- The audit's literal suggestion — mirror the hold index with
-- `WHERE Status NOT IN ('Cancelled','Rejected','Expired')` — is not
-- actually implementable: crmHoldService.assertEntityNotTaken()'s real
-- "taken" condition is `Status = 'Approved' OR ConfirmDeadline IS NULL OR
-- ConfirmDeadline >= SYSDATETIME()`, and SQL Server filtered-index
-- predicates cannot reference a non-deterministic function like
-- SYSDATETIME() — a literal mirror of that rule is impossible as a static
-- index.
--
-- What IS achievable, and closes the actually catastrophic case (two
-- CONFIRMED sales of the same unit — not two Pending requests racing,
-- which is a far lower-severity, sub-second window): a filtered unique
-- index on UnitId WHERE Status = 'Approved' AND IsActive = 1. Verified
-- against live data first — zero existing rows violate it.

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_CrmBooking_UnitId_Approved' AND object_id = OBJECT_ID('dbo.CrmBooking'))
BEGIN
  CREATE UNIQUE INDEX UQ_CrmBooking_UnitId_Approved
    ON dbo.CrmBooking(UnitId)
    WHERE Status = 'Approved' AND IsActive = 1 AND UnitId IS NOT NULL;
  PRINT 'Created UQ_CrmBooking_UnitId_Approved';
END
GO

PRINT 'Migration 389 complete — Unit double-sale backstop';
GO
