-- Migration 187: CRM sales deed customer approval fields.
-- Sales deed now mirrors the customer-facing approval loop used by agreements,
-- without exposing any internal brokerage/payment-to-broker information.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'SentToCustomerAt')
BEGIN
  ALTER TABLE dbo.CrmSalesDeed ADD SentToCustomerAt DATETIME2(3) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'CustomerApprovalStatus')
BEGIN
  ALTER TABLE dbo.CrmSalesDeed ADD CustomerApprovalStatus NVARCHAR(20) NOT NULL DEFAULT 'NotSent';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'CustomerApprovedAt')
BEGIN
  ALTER TABLE dbo.CrmSalesDeed ADD CustomerApprovedAt DATETIME2(3) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'CustomerRecheckRemarks')
BEGIN
  ALTER TABLE dbo.CrmSalesDeed ADD CustomerRecheckRemarks NVARCHAR(MAX) NULL;
END
GO

PRINT '163 CRM sales deed customer approval fields applied.';
GO
