-- Migration 306: makes the brokerage commission-rate tiers real, editable
-- master data instead of hardcoded JS constants (tierBrokeragePercent in
-- crmWorkflowGuards.js used to fix 2% under 1Cr / 1% at 1Cr+ directly in
-- code). Seeded with those exact same values so behavior doesn't change
-- until an admin actually edits a tier.

-- Same applied-by-hand-before-umzug situation as migrations 303/304 —
-- table + seed rows already exist live, so both steps below are guarded.
IF OBJECT_ID('dbo.CrmBrokerageRateTier', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CrmBrokerageRateTier (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    MinDealValue DECIMAL(18,2) NOT NULL,
    MaxDealValue DECIMAL(18,2) NULL, -- NULL = no upper bound (open-ended top tier)
    RatePercent DECIMAL(5,2) NOT NULL,
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedBy INT NULL, CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy INT NULL, UpdatedAt DATETIME2(3) NULL,
    CONSTRAINT CK_CrmBrokerageRateTier_MinMax CHECK (MaxDealValue IS NULL OR MaxDealValue > MinDealValue),
    CONSTRAINT CK_CrmBrokerageRateTier_RatePercent CHECK (RatePercent > 0 AND RatePercent <= 10)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.CrmBrokerageRateTier)
  INSERT INTO dbo.CrmBrokerageRateTier (MinDealValue, MaxDealValue, RatePercent, IsActive)
  VALUES
    (0, 10000000, 2.00, 1),          -- < 1 Cr -> 2%
    (10000000, NULL, 1.00, 1);       -- >= 1 Cr -> 1%
GO
