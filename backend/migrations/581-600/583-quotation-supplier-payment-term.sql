-- Migration 583: a payment term per supplier on a Quotation, and the log the payment-due reminders keep.
--
-- Each supplier tagged on a quotation can be given its own payment term (dbo.VendorPaymentTerm — Description +
-- Days). The Purchase Order raised for that supplier from the L1 chart starts with that term, and
-- services/poPaymentReminders.js reminds the PO's creator as its payment falls due: the PO's vendor invoice date
-- (its PO date until one is recorded) + the term's days.

IF COL_LENGTH('dbo.QuotationSuppliers', 'PaymentTermId') IS NULL
BEGIN
    ALTER TABLE dbo.QuotationSuppliers ADD PaymentTermId INT NULL
        CONSTRAINT FK_QuotationSuppliers_PaymentTerm REFERENCES dbo.VendorPaymentTerm(PaymentTermId);
    PRINT 'Added dbo.QuotationSuppliers.PaymentTermId';
END
GO

-- One row per reminder sent. Kind: 'upcoming' (due within 3 days, once), 'due' (on the day, once),
-- 'overdue' (at most once a day). DueDate is part of the key so changing the term or the invoice date reminds again.
IF OBJECT_ID('dbo.PurchaseOrderPaymentReminderLog', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PurchaseOrderPaymentReminderLog (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        PurchaseOrderId INT          NOT NULL,
        DueDate         DATE         NOT NULL,
        Kind            NVARCHAR(20) NOT NULL,
        NotifiedUserId  INT          NULL,
        SentAt          DATETIME2    NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_POPaymentReminderLog_PO ON dbo.PurchaseOrderPaymentReminderLog (PurchaseOrderId, DueDate, Kind);
    PRINT 'Created dbo.PurchaseOrderPaymentReminderLog';
END
GO
