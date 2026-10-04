-- Migration 471: give a CRM Refund's payout voucher its own single-level
-- approval workflow ("CrmRefundPayment"), instead of the multi-module
-- 2-level "NewPayment" bundle every other Payment (PO/GRN/Expense-sourced)
-- shares. Matches Received Payments' own approval pattern (one step,
-- admin/super_admin/dba/accounts_head) exactly, per explicit instruction —
-- this only touches CRM Refund payouts; every other Payment keeps its
-- existing 2-level requirement untouched.
--
-- approvalService.js routes a NewPayment row through this workflow instead
-- of the general one purely by checking SourceCrmRefundId at approve/reject
-- time (routes/newPayment.js) — no schema change needed, this migration
-- only seeds the workflow config itself.

IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE active = 1 AND modules LIKE '%"CrmRefundPayment"%')
BEGIN
    INSERT INTO dbo.ApprovalWorkflows
        (Name, type, modules, LevelsData, active, CreatedBy, CreatedAt, Module, Levels, Status)
    VALUES
        ('CRM Refund Payment Approval (single level, matches Received Payments)', 'sequential',
         '["CrmRefundPayment"]',
         '[{"id":1,"label":"Approval","roles":["admin","super_admin","dba","accounts_head"],"userIds":[]}]',
         1, 'system', SYSDATETIME(), 'CrmRefundPayment', 1, 'Active');
END
GO
