-- Migration 459: Bank Details section for Vendor Master / Contractor Master
-- (dbo.AccountHeadMaster, LHeadType 'S'/'V'/'C').
--
-- LAccountNo and LIFSCCode already exist on this table but are only ever
-- written by Bank Master's own routes (bankMaster.js), for LHeadType='B'
-- rows — safe to reuse as-is for a Supplier/Contractor's own bank account
-- number and IFSC code, since neither is populated for any other type today.
--
-- LBankName and LBranchCode are new: LBranchName already on the table means
-- the branch's *name* (Bank Master's own "Branch" field), not a code, and
-- LBankDetails is a vague free-text blob — neither is a clean fit for
-- "which bank" or "branch code" without overloading an existing column's
-- meaning, so both get their own dedicated column here instead.
--
-- All four fields are optional — a Vendor/Contractor with no bank details on
-- file is the common case, not an error.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccountHeadMaster') AND name = 'LBankName')
BEGIN
  ALTER TABLE dbo.AccountHeadMaster ADD LBankName NVARCHAR(150) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccountHeadMaster') AND name = 'LBranchCode')
BEGIN
  ALTER TABLE dbo.AccountHeadMaster ADD LBranchCode NVARCHAR(20) NULL;
END
GO
