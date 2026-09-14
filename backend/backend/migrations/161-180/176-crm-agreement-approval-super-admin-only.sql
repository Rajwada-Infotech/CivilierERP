-- Temporarily collapse CRM Agreement Senior Approval to a single level
-- gated to super_admin only. This is purely data (LevelsData JSON) — the
-- exact same column the Approval Setup UI (backend/routes/approvalWorkflows.js)
-- reads/writes — so the workflow remains fully level-wise-configurable
-- later via that UI with zero code changes. No change to approvalService.js
-- or any route logic; only this seeded config changes.
UPDATE dbo.ApprovalWorkflows
SET
  Levels = 1,
  LevelsData = '[{"id":1,"label":"Senior Approval","roles":["super_admin"]}]',
  Description = 'Single-level senior sign-off gate on CrmAgreement.SeniorApprovalStatus, currently restricted to super_admin only. Reconfigure levels/roles anytime via Admin > Approval > Approval Setup.',
  UpdatedBy = 'migration-176',
  UpdatedAt = SYSDATETIME()
WHERE modules LIKE '%crm-agreements%';
GO
