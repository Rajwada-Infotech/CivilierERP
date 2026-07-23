-- A Payment Plan used to scope to at most ONE Project (CrmPaymentPlanTemplate.
-- ProjectId, single nullable column). The real requirement: one plan can be
-- shared across several projects at once (e.g. the same milestone split used
-- on both Project X and Project Z, but not Project Y). Many-to-many join
-- table, same pattern as CrmProjectBank (migration 243) for Project<->Bank.
-- Block/Unit-level scoping stays single-value on the template itself —
-- a Block or Unit inherently belongs to one project anyway, so multi-project
-- sharing only makes sense at the Project level and above.
CREATE TABLE dbo.CrmPaymentPlanProject (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  PlanId INT NOT NULL,
  ProjectId INT NOT NULL,
  IsActive BIT NOT NULL DEFAULT 1,
  CreatedBy INT NULL,
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSDATETIME()
);
CREATE UNIQUE INDEX UQ_CrmPaymentPlanProject_Active
  ON dbo.CrmPaymentPlanProject (PlanId, ProjectId)
  WHERE IsActive = 1;

-- Backfill: every plan that already had a single ProjectId set gets that
-- link preserved as its first (and initially only) project, so existing
-- scoped plans keep working exactly as before until someone adds more.
INSERT INTO dbo.CrmPaymentPlanProject (PlanId, ProjectId, IsActive, CreatedAt)
SELECT Id, ProjectId, 1, SYSDATETIME()
FROM dbo.CrmPaymentPlanTemplate
WHERE ProjectId IS NOT NULL;
