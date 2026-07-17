-- 081-create-payment-plan-master.sql
-- Payment Plan Master for Follow-Up module
-- Stores milestone-based payment plans with percentage or fixed-amount values

IF NOT EXISTS (
  SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.PaymentPlanMaster') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.PaymentPlanMaster (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    PlanName    NVARCHAR(150)     NOT NULL,
    IsActive    BIT               NOT NULL DEFAULT 1,
    CreatedBy   INT               NULL,
    CreatedAt   DATETIME2(3)      NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedBy   INT               NULL,
    UpdatedAt   DATETIME2(3)      NULL
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.PaymentPlanMilestone') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.PaymentPlanMilestone (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    PlanId        INT               NOT NULL
                    REFERENCES dbo.PaymentPlanMaster(Id) ON DELETE CASCADE,
    MilestoneNo   INT               NOT NULL,          -- display order (1-based)
    PaymentTerm   NVARCHAR(200)     NOT NULL,           -- e.g. "On Booking", "On Slab"
    ValueType     CHAR(1)           NOT NULL DEFAULT 'P'  -- 'P' = percentage, 'A' = amount
                    CHECK (ValueType IN ('P', 'A')),
    Value         DECIMAL(18, 4)    NOT NULL DEFAULT 0,
    CreatedAt     DATETIME2(3)      NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;
