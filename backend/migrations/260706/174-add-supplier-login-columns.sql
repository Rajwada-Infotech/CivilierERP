-- ============================================================
-- Migration 173: Supplier Master — auto-generated login email + bcrypt
-- password columns on dbo.AccountHeadMaster.
--
-- Widths match dbo.users (email NVARCHAR(150), password NVARCHAR(255) —
-- bcrypt hashes are ~60 chars, 255 leaves headroom consistent with the
-- existing users table rather than inventing a new convention).
--
-- Storing the hash here too (in addition to dbo.users.password, which is
-- what actually authenticates the supplier through the existing shared
-- /login endpoint — see routes/accountHeadMaster.js POST/PUT for the
-- dbo.users upsert) is intentional duplication for on-record/audit
-- visibility directly on the Supplier Master row, exactly as requested.
-- Safe to run multiple times.
-- ============================================================

IF COL_LENGTH('dbo.AccountHeadMaster', 'SupplierLoginEmail') IS NULL
BEGIN
  ALTER TABLE dbo.AccountHeadMaster ADD SupplierLoginEmail NVARCHAR(150) NULL;
  PRINT 'Added AccountHeadMaster.SupplierLoginEmail.';
END
ELSE
  PRINT 'AccountHeadMaster.SupplierLoginEmail already exists.';
GO

IF COL_LENGTH('dbo.AccountHeadMaster', 'SupplierPassword') IS NULL
BEGIN
  ALTER TABLE dbo.AccountHeadMaster ADD SupplierPassword NVARCHAR(255) NULL;
  PRINT 'Added AccountHeadMaster.SupplierPassword.';
END
ELSE
  PRINT 'AccountHeadMaster.SupplierPassword already exists.';
GO
