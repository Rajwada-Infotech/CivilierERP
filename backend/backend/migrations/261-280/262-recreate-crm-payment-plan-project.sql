-- Migration 262: dbo.CrmPaymentPlanProject — reintroduces multi-Project
-- tagging for Payment Plans. This table existed once before (migration 248)
-- and was deliberately dropped in migration 203/204 in favor of "a plan is
-- just a reusable milestone template, scope decided from the Unit side"
-- (see crmPaymentPlans.js's own comment at the time). It's being reinstated
-- now as the top tier of a real Project -> Block -> Unit tagging hierarchy
-- (see the new dbo.CrmBlockPaymentPlan in migration 263, and
-- dbo.CrmUnitPaymentPlan which never went away).
--
-- Project-tagging is OPTIONAL, not mandatory — an untagged plan simply never
-- appears in a Project/Block-filtered dropdown, but still participates in
-- the final "all active plans" fallback everywhere (see
-- getApplicablePaymentPlans in crmEntityCreation.js).
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE name = 'CrmPaymentPlanProject' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.CrmPaymentPlanProject (
    Id         INT            IDENTITY(1,1) PRIMARY KEY,
    PlanId     INT            NOT NULL,
    ProjectId  INT            NOT NULL,
    IsActive   BIT            NOT NULL CONSTRAINT DF_CPPP_IsActive DEFAULT (1),
    CreatedBy  INT            NULL,
    CreatedAt  DATETIME2(3)   NOT NULL CONSTRAINT DF_CPPP_CreatedAt DEFAULT (SYSDATETIME())
  );

  CREATE UNIQUE INDEX UX_CrmPaymentPlanProject_Plan_Project
    ON dbo.CrmPaymentPlanProject(PlanId, ProjectId)
    WHERE IsActive = 1;

  CREATE INDEX IX_CrmPaymentPlanProject_ProjectId
    ON dbo.CrmPaymentPlanProject(ProjectId)
    INCLUDE (PlanId, IsActive);

  -- Backfill from the legacy single-project column that's still live on
  -- CrmPaymentPlanTemplate (left over from an even earlier single-project-
  -- scope design that was never fully cleaned up) — carries forward the one
  -- real existing tag (TEST PLAN A -> Royal Garden) automatically. The
  -- legacy column itself is deliberately left in place, not dropped — out
  -- of scope for this migration.
  IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate') AND name = 'ProjectId'
  )
  BEGIN
    INSERT INTO dbo.CrmPaymentPlanProject (PlanId, ProjectId)
    SELECT Id, ProjectId FROM dbo.CrmPaymentPlanTemplate WHERE ProjectId IS NOT NULL;
  END
END
