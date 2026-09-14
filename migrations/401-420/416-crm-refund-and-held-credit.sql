-- ============================================================
-- Migration 416: CRM Refund page + held-credit / re-booking money flow
--
-- Adds:
--   * Held-credit columns on CrmOnAccountPayment (Status = 'Held' rows parked
--     when a booking is cancelled — the full paid amount, no deduction yet).
--   * dbo.CrmRefund — the general-purpose refund request (cancellation held
--     credit / overpayment on-account / ad-hoc manual) with its own
--     maker -> checker -> finance-approve -> paid workflow, disbursed via a
--     spawned Finance NewPayment voucher.
--   * dbo.CrmRebookingTransfer — moves a held credit onto a NEW booking;
--     cross-company legs ride a real Finance Inter-Company FundTransfer.
--   * NewPayment.SourceCrmRefundId — links the payout voucher back to its refund.
--   * GL head "Booking Cancellation Forfeiture" (OTHER INCOME) — the deduction%
--     the company keeps when a cancelled booking is refunded (not re-booked).
--   * PageDefinitions row + marketing_head grant for pageKey 'crm-refunds'.
--
-- Idempotent — every object guarded by an existence check.
-- ============================================================

-- ── 1. Held-credit columns on CrmOnAccountPayment ────────────────────────────
IF COL_LENGTH('dbo.CrmOnAccountPayment', 'HeldFromBookingId') IS NULL
  ALTER TABLE dbo.CrmOnAccountPayment ADD HeldFromBookingId INT NULL;
GO
IF COL_LENGTH('dbo.CrmOnAccountPayment', 'HeldSourceType') IS NULL
  ALTER TABLE dbo.CrmOnAccountPayment ADD HeldSourceType NVARCHAR(30) NULL;   -- 'Cancellation'
GO
IF COL_LENGTH('dbo.CrmOnAccountPayment', 'HeldSourceRefId') IS NULL
  ALTER TABLE dbo.CrmOnAccountPayment ADD HeldSourceRefId INT NULL;            -- -> CrmCancellation.Id
GO
IF COL_LENGTH('dbo.CrmOnAccountPayment', 'HeldAt') IS NULL
  ALTER TABLE dbo.CrmOnAccountPayment ADD HeldAt DATETIME2(3) NULL;
GO

-- ── 2. dbo.CrmRefund ────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmRefund' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmRefund (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    RefundNo            NVARCHAR(30)   NULL,
    CustomerId          INT            NOT NULL REFERENCES dbo.CrmCustomer(Id),
    CompanyId           INT            NULL,
    ProjectId           INT            NULL,
    BookingId           INT            NULL,       -- source booking (cancelled or live); NULL for pure-manual
    -- CancellationHeldCredit | OverpaymentOnAccount | Manual
    SourceType          NVARCHAR(30)   NOT NULL,
    SourceOnAccountId   INT            NULL REFERENCES dbo.CrmOnAccountPayment(Id),
    SourceCancellationId INT           NULL REFERENCES dbo.CrmCancellation(Id),
    GrossAmount         DECIMAL(18,2)  NOT NULL,
    DeductionPercent    DECIMAL(5,2)   NOT NULL DEFAULT 0,   -- non-zero only for CancellationHeldCredit
    DeductionAmount     DECIMAL(18,2)  NOT NULL DEFAULT 0,
    NetAmount           DECIMAL(18,2)  NOT NULL,             -- Gross - Deduction; what the customer receives
    Reason             NVARCHAR(MAX)   NULL,
    -- Real AccountHeadMaster bank head the payout leaves from (a CrmProjectBank bank)
    RefundBankLHeadId   INT            NULL,
    -- Customer bank snapshot (default pre-filled from CrmCustomerBankDetail; editable on the form)
    CustomerBankName    NVARCHAR(200)  NULL,
    CustomerAccountNo   NVARCHAR(50)   NULL,
    CustomerIfscCode    NVARCHAR(20)   NULL,
    -- Draft | Pending | Approved | FinancePending | FinanceApproved | Paid | Rejected
    Status              NVARCHAR(20)   NOT NULL DEFAULT 'Draft',
    RefundDueDate       DATE           NULL,               -- RERA 45-day (from cancellation approval)
    FinanceNewPaymentId INT            NULL,               -- -> NewPayment.PPaymentID
    RequestedBy         INT            NULL,
    RequestedAt         DATETIME2(3)   NOT NULL DEFAULT SYSDATETIME(),
    ApprovedBy          INT            NULL,
    ApprovedAt          DATETIME2(3)   NULL,
    FinanceClearedBy    INT            NULL,
    FinanceClearedAt    DATETIME2(3)   NULL,
    PaidAt              DATETIME2(3)   NULL,
    RejectionNote       NVARCHAR(500)  NULL,
    Notes              NVARCHAR(MAX)   NULL,
    CreatedBy           INT            NULL,
    CreatedAt           DATETIME2(3)   NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy           INT            NULL,
    UpdatedAt           DATETIME2(3)   NULL
  );
  CREATE INDEX IX_CrmRefund_CustomerId       ON dbo.CrmRefund (CustomerId);
  CREATE INDEX IX_CrmRefund_Status           ON dbo.CrmRefund (Status);
  CREATE INDEX IX_CrmRefund_SourceOnAccount  ON dbo.CrmRefund (SourceOnAccountId) WHERE SourceOnAccountId IS NOT NULL;
  CREATE INDEX IX_CrmRefund_SourceCancellation ON dbo.CrmRefund (SourceCancellationId) WHERE SourceCancellationId IS NOT NULL;
  PRINT 'Created dbo.CrmRefund';
END
GO

-- ── 3. dbo.CrmRebookingTransfer ─────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmRebookingTransfer' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmRebookingTransfer (
    Id               INT IDENTITY(1,1) PRIMARY KEY,
    HeldOnAccountId  INT           NOT NULL REFERENCES dbo.CrmOnAccountPayment(Id),  -- the 'Held' row
    FromCompanyId    INT           NULL,
    ToBookingId      INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    ToCompanyId      INT           NULL,
    Amount           DECIMAL(18,2) NOT NULL,
    IsCrossCompany   BIT           NOT NULL DEFAULT 0,
    FundTransferId   INT           NULL,   -- -> FundTransfer.FTId when cross-company
    NewOnAccountId   INT           NULL REFERENCES dbo.CrmOnAccountPayment(Id),      -- fresh Unapplied row on ToBooking
    -- Draft | PendingTransfer | Applied | Rejected
    Status           NVARCHAR(20)  NOT NULL DEFAULT 'Draft',
    Notes            NVARCHAR(MAX) NULL,
    CreatedBy        INT           NULL,
    CreatedAt        DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt        DATETIME2(3)  NULL
  );
  CREATE INDEX IX_CrmRebookingTransfer_Held  ON dbo.CrmRebookingTransfer (HeldOnAccountId);
  CREATE INDEX IX_CrmRebookingTransfer_ToBkg ON dbo.CrmRebookingTransfer (ToBookingId);
  PRINT 'Created dbo.CrmRebookingTransfer';
END
GO

-- ── 4. NewPayment.SourceCrmRefundId ────────────────────────────────────────
IF COL_LENGTH('dbo.NewPayment', 'SourceCrmRefundId') IS NULL
BEGIN
  ALTER TABLE dbo.NewPayment ADD SourceCrmRefundId INT NULL;
  PRINT 'Added NewPayment.SourceCrmRefundId';
END
GO

-- ── 5. GL head: Booking Cancellation Forfeiture (OTHER INCOME) ──────────────
IF NOT EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster
  WHERE LHeadName = 'Booking Cancellation Forfeiture' AND LHeadType = 'GL'
)
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms,
     LBranchName, LCountry, IsSystemGenerated, LBelongsTo)
  VALUES
    ('Booking Cancellation Forfeiture', 'CRMCXLFORF', 'GL', 1,
     'N/A', 'N/A', 'N/A',
     'Main', 'India', 1,
     (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'OI'));
  PRINT 'Seeded GL head: Booking Cancellation Forfeiture';
END
GO

-- ── 6. Page definition + marketing_head grant for 'crm-refunds' ─────────────
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'crm-refunds', 'Refunds', 'CRM', 'CRM Finance', 'view,create,edit,delete', 665, 1, 'migration-416', SYSDATETIME()
WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'crm-refunds' AND pd.IsActive = 1);
GO

DECLARE @MhdId INT = (SELECT RId FROM dbo.Role WHERE RName = 'marketing_head');
IF @MhdId IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-refunds'
)
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
  VALUES (@MhdId, 'CRM', 'crm-refunds', 1, 1, 1, 1);
GO

PRINT '416-crm-refund-and-held-credit applied successfully.';
GO
