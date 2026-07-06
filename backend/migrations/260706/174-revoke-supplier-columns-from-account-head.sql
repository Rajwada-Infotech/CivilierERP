-- ============================================================
-- Migration 174: Revoke SupplierLoginEmail/SupplierPassword from
-- dbo.AccountHeadMaster — corrects migration 173.
--
-- AccountHeadMaster is the shared, generic ledger-head table (suppliers,
-- customers, banks, GL heads, etc. all live here as rows, differentiated
-- only by LHeadType). It was the wrong place to store login credentials:
-- doing so bolted a second, parallel credential store onto a table that
-- has nothing to do with authentication, duplicating the bcrypt hash
-- across two tables for no benefit.
--
-- The correct (and now sole) location is dbo.users — every supplier login
-- is already a real dbo.users row (role='supplier', LinkedLHeadId pointing
-- back at the AccountHeadMaster row), exactly the same mechanism every
-- other user in the system authenticates through. That row already carries
-- the real bcrypt hash and is what the shared /login endpoint actually
-- checks; AccountHeadMaster.SupplierPassword was never read by any login
-- path — it was a redundant, never-consulted copy.
--
-- Safe to run multiple times. No data loss: as of this migration these
-- columns hold no rows with data (verified before writing this migration).
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
