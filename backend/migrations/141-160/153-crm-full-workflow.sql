-- ============================================================
-- Migration 153: CRM Full Workflow
-- Application -> Booking(token %/amount, mandatory Unit) -> Welcome
-- Call -> Bank/Nominee KYC -> Agreement (senior approval + customer
-- portal approval loop) -> Brokerage (hidden from customer) ->
-- Payment Plan Master -> Sale Deed -> Tickets
-- ============================================================

-- ── Booking: mandatory unit link + token amount config + payment plan ────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'UnitId')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD UnitId INT NULL REFERENCES dbo.UnitMaster(Id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'TokenType')
BEGIN
  -- TokenType: Percentage / Amount — how the booking token was agreed
  ALTER TABLE dbo.CrmBooking ADD TokenType NVARCHAR(20) NOT NULL DEFAULT 'Percentage';
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'TokenValue')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD TokenValue DECIMAL(18,2) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'PaymentPlanId')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD PaymentPlanId INT NULL;
END
GO

-- ── Payment Plan Master (reusable milestone templates, applied by Application/Booking) ──
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmPaymentPlanTemplate' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmPaymentPlanTemplate (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    PlanName    NVARCHAR(200) NOT NULL UNIQUE,
    Description NVARCHAR(500) NULL,
    IsActive    BIT NOT NULL DEFAULT 1,
    CreatedBy   INT NULL,
    CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmPaymentPlanTemplate';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmPaymentPlanTemplateItem' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmPaymentPlanTemplateItem (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    PlanTemplateId INT NOT NULL REFERENCES dbo.CrmPaymentPlanTemplate(Id),
    MilestoneNo   INT NOT NULL,
    MilestoneName NVARCHAR(200) NOT NULL,
    [Percent]     DECIMAL(5,2) NOT NULL
  );
  PRINT 'Created dbo.CrmPaymentPlanTemplateItem';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrmBooking_PaymentPlan')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD CONSTRAINT FK_CrmBooking_PaymentPlan
    FOREIGN KEY (PaymentPlanId) REFERENCES dbo.CrmPaymentPlanTemplate(Id);
END
GO

-- ── Bank details / nominee KYC (collected before agreement preparation) ──────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmCustomerBankDetail' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmCustomerBankDetail (
    Id                INT IDENTITY(1,1) PRIMARY KEY,
    BookingId         INT NOT NULL UNIQUE REFERENCES dbo.CrmBooking(Id),
    BankName          NVARCHAR(200) NULL,
    BranchName        NVARCHAR(200) NULL,
    AccountNo         NVARCHAR(50)  NULL,
    IfscCode          NVARCHAR(20)  NULL,
    AccountHolderName NVARCHAR(200) NULL,
    NomineeName       NVARCHAR(200) NULL,
    NomineeRelation   NVARCHAR(50)  NULL,
    NomineeDob        DATE          NULL,
    NomineeContact    NVARCHAR(20)  NULL,
    NomineeAddress    NVARCHAR(500) NULL,
    PanNo             NVARCHAR(20)  NULL,
    AadhaarNo         NVARCHAR(20)  NULL,
    Notes             NVARCHAR(MAX) NULL,
    CreatedBy         INT NULL,
    CreatedAt         DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy         INT NULL,
    UpdatedAt         DATETIME2(3) NULL
  );
  PRINT 'Created dbo.CrmCustomerBankDetail';
END
GO

-- ── Customer portal login (auto-provisioned at agreement preparation) ────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmCustomerPortalUser' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmCustomerPortalUser (
    Id               INT IDENTITY(1,1) PRIMARY KEY,
    ApplicationId    INT NOT NULL UNIQUE REFERENCES dbo.CrmApplication(Id),
    Email            NVARCHAR(200) NOT NULL UNIQUE,
    PasswordHash     NVARCHAR(200) NOT NULL,
    MustChangePassword BIT NOT NULL DEFAULT 1,
    IsActive         BIT NOT NULL DEFAULT 1,
    LastLoginAt      DATETIME2(3) NULL,
    CreatedAt        DATETIME2(3) NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmCustomerPortalUser';
END
GO

-- ── Agreement: senior + customer approval workflow, mutual date scheduling ───
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'SeniorApprovalStatus')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD SeniorApprovalStatus NVARCHAR(20) NOT NULL DEFAULT 'Pending'; -- Pending/Approved/Rejected
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'SeniorApprovedBy')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD SeniorApprovedBy INT NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'SeniorApprovedAt')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD SeniorApprovedAt DATETIME2(3) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'SeniorApprovalRemarks')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD SeniorApprovalRemarks NVARCHAR(MAX) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'CustomerApprovalStatus')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD CustomerApprovalStatus NVARCHAR(20) NOT NULL DEFAULT 'Pending'; -- Pending/Approved/RecheckRequested
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'CustomerApprovedAt')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD CustomerApprovedAt DATETIME2(3) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'RecheckCount')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD RecheckCount INT NOT NULL DEFAULT 0;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'LastRecheckRemarks')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD LastRecheckRemarks NVARCHAR(MAX) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'ProposedDateByCompany')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD ProposedDateByCompany DATE NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'ProposedDateByCustomer')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD ProposedDateByCustomer DATE NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'SentToCustomerAt')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD SentToCustomerAt DATETIME2(3) NULL;
END
GO

-- Approval trail — every senior/customer approve/reject/recheck event
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmAgreementApprovalLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmAgreementApprovalLog (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    AgreementId INT NOT NULL REFERENCES dbo.CrmAgreement(Id),
    Action      NVARCHAR(30) NOT NULL, -- SeniorApprove/SeniorReject/SendToCustomer/CustomerApprove/CustomerRecheck
    Remarks     NVARCHAR(MAX) NULL,
    ActorType   NVARCHAR(20) NOT NULL, -- Staff/Customer
    ActorId     INT NULL,
    ActorName   NVARCHAR(200) NULL,
    CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmAgreementApprovalLog';
END
GO

-- ── Brokerage (internal only — never surfaced to the customer portal) ────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmBrokerageMaster' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmBrokerageMaster (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    BookingId      INT NOT NULL UNIQUE REFERENCES dbo.CrmBooking(Id),
    BrokerName     NVARCHAR(200) NOT NULL,
    BrokerFirm     NVARCHAR(200) NULL,
    BrokerContact  NVARCHAR(20)  NULL,
    RateType       NVARCHAR(20)  NOT NULL DEFAULT 'Percentage', -- Percentage/Amount
    RateValue      DECIMAL(18,2) NOT NULL,
    ComputedAmount DECIMAL(18,2) NULL,
    Status         NVARCHAR(20)  NOT NULL DEFAULT 'Pending', -- Pending/Approved/Paid
    ApprovedBy     INT NULL,
    ApprovedAt     DATETIME2(3) NULL,
    Notes          NVARCHAR(MAX) NULL,
    CreatedBy      INT NULL,
    CreatedAt      DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy      INT NULL,
    UpdatedAt      DATETIME2(3) NULL
  );
  PRINT 'Created dbo.CrmBrokerageMaster';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmBrokerPayment' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmBrokerPayment (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    BrokerageId   INT NOT NULL REFERENCES dbo.CrmBrokerageMaster(Id),
    Amount        DECIMAL(18,2) NOT NULL,
    PaidDate      DATE NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
    PaymentMode   NVARCHAR(50) NULL,
    TransactionRef NVARCHAR(200) NULL,
    Notes         NVARCHAR(MAX) NULL,
    CreatedBy     INT NULL,
    CreatedAt     DATETIME2(3) NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmBrokerPayment';
END
GO

-- ── Page Definitions (staff-only; customer portal has its own separate auth) ─
DECLARE @base INT = 900;

MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-customer-bank-details', 'Customer Bank & Nominee', 'CRM', 'CRM Pipeline', 'view,create,edit', @base + 5,  1, 'migration-153'),
  ('crm-brokerage',             'Brokerage Master',        'CRM', 'CRM Finance',  'view,create,edit', @base + 10, 1, 'migration-153'),
  ('crm-payment-plans',         'Payment Plan Master',     'CRM', 'CRM Finance',  'view,create,edit', @base + 15, 1, 'migration-153')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, GETDATE());

PRINT 'Seeded CRM workflow PageDefinitions';
GO
