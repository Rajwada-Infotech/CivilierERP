-- Reverses migration 270's 1:1 restriction: a Payment Plan may now be
-- tagged to MULTIPLE Projects again (true many-to-many, matching how a
-- Bank Master row can already be tagged to many Projects via
-- dbo.CrmProjectBank). The junction table dbo.CrmPaymentPlanProject and its
-- (PlanId, ProjectId) unique index (from migration 248/262) are kept as-is
-- — this migration only drops the extra PlanId-only unique index that was
-- forcing at most one active row per plan.

IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmPaymentPlanProject') AND name = 'UQ_CrmPaymentPlanProject_OnePerPlan')
  DROP INDEX UQ_CrmPaymentPlanProject_OnePerPlan ON dbo.CrmPaymentPlanProject;
GO
