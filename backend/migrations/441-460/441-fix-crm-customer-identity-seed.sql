-- Migration 441: fix CrmCustomer identity seed corrupted by a manual reseed
--
-- dbo.CrmCustomer.Id is defined as IDENTITY(1,1) (see migration 206) — no
-- script in this codebase ever calls DBCC CHECKIDENT/RESEED on it. The
-- production database somehow ended up with its first-ever row (CustomerNo
-- 'CUST-2026-00001', CustomerName 'Sumit Mukherjee') carrying Id = 0, which
-- can only happen if someone manually reseeded the identity to -1 (so the
-- next auto-generated value came out as 0) instead of 0 (which would have
-- correctly produced 1). Id = 0 is then indistinguishable from "no customer
-- selected" everywhere in the app that does `if (!customerId)` — e.g.
-- createCrmApplicationRecord's own required-field check — so this customer
-- can never actually be picked to create an Application.
--
-- SAFE TO RUN AS-IS ONLY IF confirmed (as it was for the row this migration
-- was written against) that:
--   1. No other row anywhere already has Id = 0 for this table.
--   2. Nothing yet references CustomerId = 0 (CrmApplication, CrmBooking,
--      CrmCustomerBankDetail, CrmRefund, etc.) — the checks below verify
--      this and abort instead of guessing if anything does.
-- If a real reference to CustomerId = 0 is found, STOP — that means an
-- Application/Booking/etc. was actually created against this broken row and
-- needs re-pointing at the corrected Id as part of this same transaction,
-- not something safe to script blindly without seeing that data.

IF NOT EXISTS (SELECT 1 FROM dbo.CrmCustomer WHERE Id = 0)
BEGIN
  PRINT 'No CrmCustomer row with Id = 0 — nothing to fix.';
  RETURN;
END

IF (SELECT COUNT(*) FROM dbo.CrmCustomer WHERE Id = 0) > 1
BEGIN
  RAISERROR('More than one CrmCustomer row has Id = 0 — this should be impossible for a PK and needs manual investigation, not this migration.', 16, 1);
  RETURN;
END

-- Abort loudly instead of silently corrupting/orphaning data if anything
-- already points at the broken Id. Add any other FK-to-CrmCustomer table
-- here if one exists that isn't listed (grep for "REFERENCES dbo.CrmCustomer"
-- and "CustomerId" across backend/migrations to double check before running).
IF EXISTS (SELECT 1 FROM dbo.CrmApplication WHERE CustomerId = 0)
   OR EXISTS (SELECT 1 FROM dbo.CrmRefund WHERE CustomerId = 0)
BEGIN
  RAISERROR('CustomerId = 0 is already referenced elsewhere — do not run this migration blindly. Re-point those references as part of a manual, reviewed fix instead.', 16, 1);
  RETURN;
END

-- Pick the next real identity value the table should have used instead of 0.
DECLARE @NextId INT = (SELECT ISNULL(MAX(Id), 0) + 1 FROM dbo.CrmCustomer WHERE Id <> 0);
IF EXISTS (SELECT 1 FROM dbo.CrmCustomer WHERE Id = @NextId)
BEGIN
  RAISERROR('Computed replacement Id already exists — data changed since this migration was written; investigate manually.', 16, 1);
  RETURN;
END

SET XACT_ABORT ON;
BEGIN TRAN;

  SET IDENTITY_INSERT dbo.CrmCustomer ON;

  INSERT INTO dbo.CrmCustomer
    (Id, CustomerNo, LeadId, CustomerName, Mobile, AltMobile, Email, PanNo, AadhaarNo,
     Occupation, AnnualIncome, Address, City, State, Pincode,
     CurrentAddress, CurrentCity, CurrentState, CurrentPincode, IsCurrentSameAsPermanent,
     DateOfBirth, InvoiceMode, Notes, IsActive, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt)
  SELECT
    @NextId, CustomerNo, LeadId, CustomerName, Mobile, AltMobile, Email, PanNo, AadhaarNo,
    Occupation, AnnualIncome, Address, City, State, Pincode,
    CurrentAddress, CurrentCity, CurrentState, CurrentPincode, IsCurrentSameAsPermanent,
    DateOfBirth, InvoiceMode, Notes, IsActive, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt
  FROM dbo.CrmCustomer WHERE Id = 0;

  SET IDENTITY_INSERT dbo.CrmCustomer OFF;

  DELETE FROM dbo.CrmCustomer WHERE Id = 0;

  -- Reseed so the NEXT customer created gets @NextId + 1, not another
  -- collision — DBCC CHECKIDENT's RESEED value is "the last used value",
  -- so the true max across the whole table (now that @NextId is real) is
  -- what to reseed to.
  DECLARE @ReseedTo INT = (SELECT MAX(Id) FROM dbo.CrmCustomer);
  DBCC CHECKIDENT ('dbo.CrmCustomer', RESEED, @ReseedTo);

COMMIT TRAN;
PRINT 'Fixed: CrmCustomer Id 0 -> ' + CAST(@NextId AS NVARCHAR(10)) + ', identity reseeded.';
GO
