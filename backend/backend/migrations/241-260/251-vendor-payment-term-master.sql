-- Finance Setup > Payment Terms — a dedicated master for vendor/procurement
-- payment terms (Description + Days), used by Purchase Order's new Payment
-- Terms dropdown and Invoice's real-time due-date calculation (Vendor
-- Invoice Date + Days). Deliberately a separate table from
-- dbo.PaymentTermMaster (Follow-Up's CRM payment-plan/installment master —
-- percent/fixed milestone amounts against a booking, a different concept
-- entirely from "net N days from a vendor invoice").
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VendorPaymentTerm'
)
BEGIN
    CREATE TABLE dbo.VendorPaymentTerm (
        PaymentTermId  INT            NOT NULL IDENTITY(1,1) PRIMARY KEY,
        Description    NVARCHAR(500)  NOT NULL,
        Days           INT            NOT NULL,
        IsActive       BIT            NOT NULL DEFAULT 1,
        CreatedBy      NVARCHAR(150)  NULL,
        CreatedAt      DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        UpdatedBy      NVARCHAR(150)  NULL,
        UpdatedAt      DATETIME2      NULL
    );
    PRINT 'dbo.VendorPaymentTerm created.';
END
ELSE
    PRINT 'dbo.VendorPaymentTerm already exists — skipped.';
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'PurchaseOrders' AND COLUMN_NAME = 'PaymentTermId'
)
    ALTER TABLE dbo.PurchaseOrders ADD PaymentTermId INT NULL;
GO
