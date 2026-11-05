-- Migration 567: a credit note WITHOUT a refund, and approval to cancel one.
--
-- 1. Adjustment credit note: an invoice is reduced (discount, area change,
--    price correction) and the money stays with us. Raised by staff, approved
--    through workflow 'crm-credit-notes'; on approval the booking's value and
--    the invoice's milestone come down, anything already paid above the new
--    amount becomes credit on the customer's account (a CrmOnAccountPayment
--    row, no new cash), and the invoice's income goes back to Advance from
--    Customer. GST stays as paid while the money is held as an advance — it is
--    given back only when that money is refunded (the refund's own voucher).
-- 2. Cancelling any credit note now needs a second person: workflow
--    'crm-credit-note-cancel' (CancelApprovalStatus), applied on approval.
-- CrmBooking.CreditNoteTotal / CreditNoteGst: what adjustment credit notes took
-- off the booking — the booking's GST recalculation subtracts them, so a later
-- re-price never brings the reduced value back.

-- RefundId becomes optional (an adjustment has no refund).
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmGstNote') AND name = 'RefundId' AND is_nullable = 0)
BEGIN
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmGstNote_Refund' AND object_id = OBJECT_ID('dbo.CrmGstNote'))
    DROP INDEX IX_CrmGstNote_Refund ON dbo.CrmGstNote;
  ALTER TABLE dbo.CrmGstNote ALTER COLUMN RefundId INT NULL;
  CREATE INDEX IX_CrmGstNote_Refund ON dbo.CrmGstNote (RefundId);
END
GO
IF COL_LENGTH('dbo.CrmGstNote', 'Source') IS NULL
  ALTER TABLE dbo.CrmGstNote ADD Source NVARCHAR(20) NOT NULL CONSTRAINT DF_CrmGstNote_Source DEFAULT N'Refund'; -- Refund | Adjustment
IF COL_LENGTH('dbo.CrmGstNote', 'ReasonType') IS NULL
  ALTER TABLE dbo.CrmGstNote ADD ReasonType NVARCHAR(40) NULL;               -- Discount | AreaChange | PriceCorrection | Other
IF COL_LENGTH('dbo.CrmGstNote', 'ApprovalStatus') IS NULL
  ALTER TABLE dbo.CrmGstNote ADD ApprovalStatus NVARCHAR(20) NULL,          -- adjustment: Draft | Pending | Approved | Rejected
    RequestedById INT NULL, RequestedAt DATETIME2 NULL, ApprovedAt DATETIME2 NULL, RejectionNote NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.CrmGstNote', 'MilestoneId') IS NULL
  ALTER TABLE dbo.CrmGstNote ADD MilestoneId INT NULL, OnAccountId INT NULL, MovedToAccount DECIMAL(18,2) NULL;
IF COL_LENGTH('dbo.CrmGstNote', 'CancelApprovalStatus') IS NULL
  ALTER TABLE dbo.CrmGstNote ADD CancelApprovalStatus NVARCHAR(20) NULL,    -- Pending | Approved | Rejected
    CancelRequestedById INT NULL, CancelRequestedAt DATETIME2 NULL, CancelRequestReason NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.CrmBooking', 'CreditNoteTotal') IS NULL
  ALTER TABLE dbo.CrmBooking ADD CreditNoteTotal DECIMAL(18,2) NOT NULL CONSTRAINT DF_CrmBooking_CreditNoteTotal DEFAULT 0,
    CreditNoteGst DECIMAL(18,2) NOT NULL CONSTRAINT DF_CrmBooking_CreditNoteGst DEFAULT 0;
GO

-- Approval workflows start from the refund approval (same people sign off
-- money going back to a customer). Approval Setup edits them separately.
IF OBJECT_ID('dbo.ApprovalWorkflows', 'U') IS NOT NULL
BEGIN
  DECLARE @pairs TABLE (NewModule NVARCHAR(100), Name NVARCHAR(200), Descr NVARCHAR(500));
  INSERT INTO @pairs VALUES
    (N'crm-credit-notes', N'CRM Credit Note (invoice reduced)', N'An invoice reduced without a refund — discount, area change, price correction. Started from the refund approval.'),
    (N'crm-credit-note-cancel', N'CRM Credit Note — Cancellation', N'Cancelling a credit note (a GST document). Started from the refund approval.');
  DECLARE @m NVARCHAR(100), @n NVARCHAR(200), @d NVARCHAR(500);
  DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT NewModule, Name, Descr FROM @pairs;
  OPEN cur; FETCH NEXT FROM cur INTO @m, @n, @d;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE modules LIKE N'%"' + @m + N'"%')
    BEGIN
      INSERT INTO dbo.ApprovalWorkflows (Name, Module, Levels, Approvers, Status, Description, CreatedBy, CreatedAt, type, modules, active, LevelsJson, LevelsData)
      SELECT TOP 1 @n, N'CrmGstNote', w.Levels, w.Approvers, N'Active', @d, N'migration-567', SYSDATETIME(), ISNULL(w.type, N'sequential'),
             N'["' + @m + N'"]', 1, ISNULL(w.LevelsJson, N'[]'), w.LevelsData
      FROM dbo.ApprovalWorkflows w WHERE w.modules LIKE N'%"crm-refunds"%' AND w.active = 1 ORDER BY w.Id;
      IF @@ROWCOUNT = 0 PRINT CONCAT('Migration 567: no crm-refunds workflow to start ', @m, ' from — set it up in Approval Setup.');
    END
    FETCH NEXT FROM cur INTO @m, @n, @d;
  END
  CLOSE cur; DEALLOCATE cur;
END
GO
