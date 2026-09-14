-- 082b-flatten-payment-plan-master.sql
-- Replaces plan-grouped tables with a flat PaymentTermMaster
-- ValueType: 'percent' | 'fixed'
-- NOTE: Seed data removed - terms are managed via Payment Plan Master UI.

-- Drop old tables (milestones first due to FK)
IF OBJECT_ID('dbo.UnitPaymentTerms',    'U') IS NOT NULL DROP TABLE dbo.UnitPaymentTerms;
IF OBJECT_ID('dbo.BookingPaymentTerms', 'U') IS NOT NULL DROP TABLE dbo.BookingPaymentTerms;
IF OBJECT_ID('dbo.PaymentPlanMilestone','U') IS NOT NULL DROP TABLE dbo.PaymentPlanMilestone;
IF OBJECT_ID('dbo.PaymentPlanMaster',   'U') IS NOT NULL DROP TABLE dbo.PaymentPlanMaster;
IF OBJECT_ID('dbo.PaymentTermMaster',   'U') IS NOT NULL DROP TABLE dbo.PaymentTermMaster;

CREATE TABLE dbo.PaymentTermMaster (
  TermID      INT IDENTITY(1,1) PRIMARY KEY,
  TermName    NVARCHAR(200)  NOT NULL,
  ValueType   NVARCHAR(20)   NOT NULL DEFAULT 'percent'
                CHECK (ValueType IN ('percent', 'fixed')),
  TermValue   DECIMAL(18,4)  NOT NULL DEFAULT 0,
  IsActive    BIT            NOT NULL DEFAULT 1,
  CreatedBy   INT            NULL,
  CreatedAt   DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedBy   INT            NULL,
  UpdatedAt   DATETIME2(3)   NULL
);

CREATE INDEX IX_PaymentTermMaster_IsActive ON dbo.PaymentTermMaster (IsActive);

CREATE TABLE dbo.BookingPaymentTerms (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  BookingID INT NOT NULL,
  TermID    INT NOT NULL REFERENCES dbo.PaymentTermMaster(TermID),
  DueDate   DATE          NULL,
  IsPaid    BIT           NOT NULL DEFAULT 0,
  PaidOn    DATETIME2(3)  NULL,
  CreatedAt DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_BookingPaymentTerms_BookingID ON dbo.BookingPaymentTerms (BookingID);
CREATE INDEX IX_BookingPaymentTerms_TermID    ON dbo.BookingPaymentTerms (TermID);

CREATE TABLE dbo.UnitPaymentTerms (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  UnitID    INT NOT NULL,
  TermID    INT NOT NULL REFERENCES dbo.PaymentTermMaster(TermID),
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_UnitPaymentTerms_UnitID  ON dbo.UnitPaymentTerms (UnitID);
CREATE INDEX IX_UnitPaymentTerms_TermID  ON dbo.UnitPaymentTerms (TermID);