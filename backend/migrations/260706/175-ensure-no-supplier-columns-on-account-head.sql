-- ============================================================
-- Migration 174: Defensively ensure dbo.AccountHeadMaster carries no
-- supplier login columns.
--
-- AccountHeadMaster is the shared, generic ledger-head table (suppliers,
-- customers, banks, GL heads, etc. all live here as rows, differentiated
-- only by LHeadType). It has nothing to do with authentication — storing
-- login credentials there would bolt a second, parallel credential store
-- onto a table that was never meant to hold them.
--
-- The correct (and only) location for a supplier's login is dbo.users —
-- every supplier login is a real dbo.users row (role='supplier',
-- LinkedLHeadId pointing back at the AccountHeadMaster row), exactly the
-- same mechanism every other user in the system authenticates through.
-- See routes/accountHeadMaster.js (supplier create/update) and
-- routes/supplierPortal.js (resolveSupplier) for the actual login path.
--
-- Idempotent and safe to run on any environment regardless of history:
-- drops SupplierLoginEmail/SupplierPassword from AccountHeadMaster if
-- present, no-ops otherwise.
-- ============================================================

IF COL_LENGTH('dbo.AccountHeadMaster', 'SupplierLoginEmail') IS NOT NULL
BEGIN
  ALTER TABLE dbo.AccountHeadMaster DROP COLUMN SupplierLoginEmail;
  PRINT 'Dropped AccountHeadMaster.SupplierLoginEmail.';
END
ELSE
  PRINT 'AccountHeadMaster.SupplierLoginEmail already absent.';
GO

IF COL_LENGTH('dbo.AccountHeadMaster', 'SupplierPassword') IS NOT NULL
BEGIN
  ALTER TABLE dbo.AccountHeadMaster DROP COLUMN SupplierPassword;
  PRINT 'Dropped AccountHeadMaster.SupplierPassword.';
END
ELSE
  PRINT 'AccountHeadMaster.SupplierPassword already absent.';
GO
