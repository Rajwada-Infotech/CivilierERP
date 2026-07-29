-- Migration 263: dbo.CrmBlockPaymentPlan — the new middle tier of the
-- Project -> Block -> Unit Payment Plan tagging hierarchy (see migration 262
-- for the Project tier, dbo.CrmUnitPaymentPlan for the pre-existing Unit
-- tier). A Block's own tagged plans must be a subset of its Project's
-- tagged plans (enforced in blockMaster.js's POST/PUT, not here) — this
-- table just records the tag itself.
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE name = 'CrmBlockPaymentPlan' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.CrmBlockPaymentPlan (
    Id         INT            IDENTITY(1,1) PRIMARY KEY,
    BlockId    INT            NOT NULL,
    PlanId     INT            NOT NULL,
    IsActive   BIT            NOT NULL CONSTRAINT DF_CBPP_IsActive DEFAULT (1),
    CreatedBy  INT            NULL,
    CreatedAt  DATETIME2(3)   NOT NULL CONSTRAINT DF_CBPP_CreatedAt DEFAULT (SYSDATETIME())
  );

  CREATE UNIQUE INDEX UX_CrmBlockPaymentPlan_Block_Plan
    ON dbo.CrmBlockPaymentPlan(BlockId, PlanId)
    WHERE IsActive = 1;

  CREATE INDEX IX_CrmBlockPaymentPlan_BlockId
    ON dbo.CrmBlockPaymentPlan(BlockId)
    INCLUDE (PlanId, IsActive);
END
