-- Migration 356: RegistrationDeadline on CrmSalesDeed (C6 — RERA compliance)
--
-- Stores the staff-set deadline by which the property must be registered at
-- the Sub-Registrar's Office after the Sale Deed is executed. The SLA engine
-- notifies the assigned salesperson when this date passes without a
-- RegistrationNo being recorded. A NULL deadline means no tracking applies
-- (pre-migration deeds, or deals where registration is not yet due).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'RegistrationDeadline'
)
BEGIN
  ALTER TABLE dbo.CrmSalesDeed ADD RegistrationDeadline DATE NULL;
END
GO

PRINT 'Migration 356 complete — RegistrationDeadline on CrmSalesDeed';
