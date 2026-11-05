-- Migration 550: resale and buy-back of any sold property, through the Approval Inbox.
--
-- A resale is now an ENDORSEMENT: the seller's booking itself passes to the new
-- buyer (same milestones, same money paid, remaining schedule continues), and
-- for a plot with its villa both bookings pass together. A buy-back is the
-- developer buying the property back at an agreed price; the property returns
-- to stock. Both are approved through approvalService ('crm-resales').
--
--   Kind              'Resale' (to another buyer) | 'BuyBack' (to the developer)
--   BookingIds        the bookings moving: the seller's booking, plus its plot/villa partner
--   PaidAtTransfer    what the seller had paid when it completed (moves to the buyer's ledger)
--   TdsAmount / BuyBackGstAmount / StampDutyAmount   buy-back figures as the CA advises (recorded, not computed)
--   ApprovedBy/At, RejectionNote, CompletedAt         workflow
-- Status also admits 'Rejected'.

IF COL_LENGTH('dbo.CrmUnitResale', 'Kind') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD Kind NVARCHAR(10) NOT NULL CONSTRAINT DF_CrmUnitResale_Kind DEFAULT (N'Resale');
IF COL_LENGTH('dbo.CrmUnitResale', 'BookingIds') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD BookingIds NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'PaidAtTransfer') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD PaidAtTransfer DECIMAL(18, 2) NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'TdsAmount') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD TdsAmount DECIMAL(18, 2) NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'BuyBackGstAmount') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD BuyBackGstAmount DECIMAL(18, 2) NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'StampDutyAmount') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD StampDutyAmount DECIMAL(18, 2) NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'ApprovedBy') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD ApprovedBy INT NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'ApprovedAt') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD ApprovedAt DATETIME2(0) NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'RejectionNote') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD RejectionNote NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'CompletedAt') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD CompletedAt DATETIME2(0) NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'PayoutNewPaymentId') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD PayoutNewPaymentId INT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CrmUnitResale_Status' AND definition NOT LIKE '%Rejected%')
BEGIN
  ALTER TABLE dbo.CrmUnitResale DROP CONSTRAINT CK_CrmUnitResale_Status;
  ALTER TABLE dbo.CrmUnitResale WITH NOCHECK
    ADD CONSTRAINT CK_CrmUnitResale_Status CHECK (Status IN (N'Pending', N'Approved', N'Completed', N'Cancelled', N'Rejected'));
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CrmUnitResale_Kind')
  ALTER TABLE dbo.CrmUnitResale WITH NOCHECK ADD CONSTRAINT CK_CrmUnitResale_Kind CHECK (Kind IN (N'Resale', N'BuyBack'));
GO

UPDATE dbo.PageDefinitions SET Label = N'Resale & Buy-back' WHERE PageKey = 'crm-resales' AND Label <> N'Resale & Buy-back';
GO
