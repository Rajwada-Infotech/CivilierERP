-- Migration 238: CRM customer KYC source fields
-- Bank/KYC requires Aadhaar and occupation. Keep those on the customer
-- master so Application/Booking/Bank Detail pages can all consume the same
-- source instead of asking staff to retype them downstream.

IF OBJECT_ID('dbo.CrmCustomer', 'U') IS NOT NULL
BEGIN
  IF COL_LENGTH('dbo.CrmCustomer', 'AadhaarNo') IS NULL
    ALTER TABLE dbo.CrmCustomer ADD AadhaarNo NVARCHAR(20) NULL;

  IF COL_LENGTH('dbo.CrmCustomer', 'Occupation') IS NULL
    ALTER TABLE dbo.CrmCustomer ADD Occupation NVARCHAR(100) NULL;

  IF COL_LENGTH('dbo.CrmCustomer', 'AnnualIncome') IS NULL
    ALTER TABLE dbo.CrmCustomer ADD AnnualIncome DECIMAL(18,2) NULL;

  PRINT 'Added CRM customer KYC source fields';
END
GO
