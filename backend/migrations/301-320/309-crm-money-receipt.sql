-- ============================================================
-- Migration 309: Money Receipt
--
-- New, independent record type — NOT a view onto ReceivedPayment. Staff
-- create one per booking once the Booking's Data Review checklist (all 7
-- items, dbo.CrmApplicationVerificationChecklist Level 1) is fully checked.
-- It's downloadable as a PDF immediately (always marked "Pending Approval"
-- on the document itself until Status = 'Approved'), independent of the
-- Marketing Head / Director two-level Booking approval running in parallel.
--
-- Approval is gated on the Booking being fully Confirmed (both levels
-- approved) and is restricted to Account's Head / Finance roles (same
-- APPROVER_ROLES as receivedPayment.js: admin, super_admin, dba,
-- "Account's Head" — NOT the Marketing Head/Director booking roles).
--
-- On approval: (a) raises the existing Demand against the booking's
-- Milestone #1 row (dbo.CrmPaymentMilestone's own Demand* columns —
-- reusing crmPayments.js's raiseDemandForMilestone(), not a new table),
-- (b) creates a booking-linked-only ReceivedPayment row (CrmBookingId set,
-- CrmMilestoneId null — the existing "on-account" pattern) that lands in
-- Finance's Received Payment queue, Pending, until Account's Head approves
-- there too — that second approval is what "hits the bank".
--
-- A bad cheque/instrument moves Status to 'Bounced' (mandatory remark),
-- which allows edit-and-resubmit back to 'Pending' — same reopens-not-
-- terminal pattern as the Booking stage rejects.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmMoneyReceipt' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmMoneyReceipt (
    Id                INT IDENTITY(1,1) PRIMARY KEY,
    ReceiptNo         NVARCHAR(30)  NOT NULL UNIQUE,
    BookingId         INT           NOT NULL REFERENCES dbo.CrmBooking(Id),

    Amount            DECIMAL(18,2) NOT NULL,
    PaymentMode       NVARCHAR(30)  NOT NULL, -- Cheque | Cash | NEFT | RTGS | UPI | Other
    ChequeNo          NVARCHAR(50)  NULL,
    ChequeDate        DATE          NULL,
    BankName          NVARCHAR(150) NULL,
    TransactionRef    NVARCHAR(150) NULL,
    ReceivedDate      DATE          NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
    Remarks           NVARCHAR(500) NULL,

    -- Pending -> Approved (terminal-ish, but see Bounced) | Bounced (reopens
    -- to Pending after edit-and-resubmit, never a dead end).
    Status            NVARCHAR(20)  NOT NULL DEFAULT 'Pending',

    PdfBase64         NVARCHAR(MAX) NULL,
    PdfGeneratedAt    DATETIME2(3)  NULL,

    -- Set only once Status = 'Approved' — the linkage back to the
    -- Finance queue row this receipt's approval created.
    ReceivedPaymentId INT           NULL,
    DemandRaised      BIT           NOT NULL DEFAULT 0,

    BouncedReason     NVARCHAR(500) NULL,
    BouncedBy         INT           NULL,
    BouncedAt         DATETIME2(3)  NULL,

    CreatedBy         INT           NULL,
    CreatedAt         DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt         DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    ApprovedBy        INT           NULL,
    ApprovedAt        DATETIME2(3)  NULL
  );
  PRINT 'Created dbo.CrmMoneyReceipt';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmMoneyReceipt_BookingId' AND object_id = OBJECT_ID('dbo.CrmMoneyReceipt'))
BEGIN
  CREATE INDEX IX_CrmMoneyReceipt_BookingId ON dbo.CrmMoneyReceipt(BookingId);
  PRINT 'Created IX_CrmMoneyReceipt_BookingId';
END
GO

MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-money-receipts', 'Money Receipts', 'CRM', 'Finance', 'view,create,edit,delete', 855, 1, 'migration-309'),
  ('crm-invoices',       'Invoices',       'CRM', 'Finance', 'view,create,delete',       856, 1, 'migration-309')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, SYSDATETIME());
GO

SELECT PageKey, Label, Module, GroupName FROM dbo.PageDefinitions WHERE PageKey IN ('crm-money-receipts', 'crm-invoices');
GO
