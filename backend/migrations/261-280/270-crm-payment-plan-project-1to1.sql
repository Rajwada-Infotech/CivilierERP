-- Reverses the many-to-many design from migration 248: a Payment Plan may
-- now be tagged to at most ONE Project (a Project can still have many
-- Plans tagged to it — this is a 1:1 mapping from the Plan's side only,
-- not a symmetric one-to-one table). The junction table itself is kept
-- (no schema churn, no data loss) — this just adds the constraint the
-- application layer now enforces too, so it holds even against direct SQL.
--
-- If any plan currently has more than one active tagged Project (possible
-- under the old migration-248 rule), keep only the most recently created
-- tag and deactivate the rest, so the new unique index can actually be
-- created — this is a genuine business-rule narrowing the user asked for,
-- not just a schema tweak.
;WITH ranked AS (
  SELECT Id, ROW_NUMBER() OVER (PARTITION BY PlanId ORDER BY CreatedAt DESC, Id DESC) AS rn
  FROM dbo.CrmPaymentPlanProject
  WHERE IsActive = 1
)
UPDATE cpp SET IsActive = 0
FROM dbo.CrmPaymentPlanProject cpp
JOIN ranked r ON r.Id = cpp.Id
WHERE r.rn > 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmPaymentPlanProject') AND name = 'UQ_CrmPaymentPlanProject_OnePerPlan')
  CREATE UNIQUE INDEX UQ_CrmPaymentPlanProject_OnePerPlan ON dbo.CrmPaymentPlanProject(PlanId) WHERE IsActive = 1;
GO
