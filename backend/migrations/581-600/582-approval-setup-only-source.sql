-- Migration 582: Approval Setup becomes the only source of approvers.
--
-- Until now who may approve was decided partly in code: a default role list
-- (admin/super_admin/dba), per-module overrides, a CRM list, a Menu Rights
-- fallback ("edit" on the Approval Inbox page), admin/super_admin passing
-- every level, and separate lists for Received Payments, Money Receipts,
-- the refund finance step and two lock overrides. That code is removed in
-- the same release; from now on a user may approve only where a workflow in
-- Approval Setup names their role or names them.
--
-- So nothing stops working, every approval gate that has NO active workflow
-- gets one here, copying the roles the code allowed until now (the one-time
-- carry-over of that code, recorded as data). Gates that already have a
-- workflow — e.g. production, seeded 2026-10-27 — are left untouched. Only
-- roles that exist in Role Master are written. Safe to run again.

DECLARE @seed TABLE (Module NVARCHAR(100) NOT NULL, Roles NVARCHAR(400) NOT NULL, Label NVARCHAR(200) NOT NULL);
INSERT INTO @seed (Module, Roles, Label) VALUES
  (N'BOQ', N'admin,super_admin,dba', N'BOQ'),
  (N'Contract', N'admin,super_admin,dba', N'Contract'),
  (N'Expenses', N'admin,super_admin,dba', N'Expenses'),
  (N'GRN', N'admin,super_admin,dba', N'Goods Receipt (GRN)'),
  (N'MaterialIssueReturn', N'admin,super_admin,dba', N'Material Issue Return'),
  (N'MaterialIssues', N'admin,super_admin,dba', N'Material Issue'),
  (N'MaterialRequests', N'admin,super_admin,dba', N'Material Request'),
  (N'NewPayment', N'admin,super_admin,dba', N'Payment'),
  (N'PurchaseOrders', N'admin,super_admin,dba', N'Purchase Order'),
  (N'SaleOrder', N'admin,super_admin,dba', N'Sale Order'),
  (N'StockTransfer', N'admin,super_admin,dba', N'Stock Transfer'),
  (N'VehicleInOut', N'admin,super_admin,dba', N'Vehicle In/Out'),
  (N'WorkDone', N'admin,super_admin,dba', N'Work Done'),
  (N'WorkOrderHeader', N'admin,super_admin,dba', N'Work Order'),
  (N'debit-note', N'admin,super_admin,dba', N'Debit Note'),
  (N'FundTransfer', N'super_admin', N'Fund Transfer'),
  (N'InterCompanyTransfer', N'super_admin', N'Inter-Company Transfer'),
  (N'JournalVoucher', N'super_admin', N'Journal Voucher'),
  (N'CrmRefundPayment', N'admin,super_admin,dba,accounts_head', N'CRM Refund Payment'),
  (N'crm-agreement-date', N'super_admin', N'CRM Agreement (Date Approval)'),
  (N'crm-agreements', N'admin,super_admin,marketing_head,legal_head', N'CRM Agreement (Senior Approval)'),
  (N'crm-applications', N'admin,super_admin,marketing_head', N'CRM Application'),
  (N'crm-booking-amendment', N'admin,super_admin,marketing_head', N'CRM Booking Amendment'),
  (N'crm-brokerage', N'admin,super_admin,marketing_head', N'CRM Brokerage'),
  (N'crm-cancellations', N'admin,super_admin,marketing_head', N'CRM Cancellation'),
  (N'crm-credit-note-cancel', N'admin,super_admin,dba', N'Credit Note — Cancellation'),
  (N'crm-credit-notes', N'admin,super_admin,dba', N'Credit Note (invoice reduced)'),
  (N'crm-mutation-approve', N'admin,super_admin,marketing_head,legal_head', N'CRM Mutation Approve'),
  (N'crm-noc', N'admin,super_admin,marketing_head', N'CRM NOC'),
  (N'crm-query-payment-confirm', N'admin,super_admin,marketing_head,legal_head', N'CRM Query Payment Confirm'),
  (N'crm-refunds', N'admin,super_admin,marketing_head', N'CRM Refund'),
  (N'crm-registry-cancel', N'admin,super_admin,marketing_head', N'CRM Registry Cancel'),
  (N'crm-registry-complete', N'admin,super_admin,marketing_head,legal_head', N'CRM Registry Complete'),
  (N'crm-sales-deed-director', N'super_admin', N'CRM Sale Deed (Director Approval)'),
  (N'crm-sales-deed-senior', N'admin,super_admin,marketing_head', N'CRM Sale Deed (Senior Approval)'),
  (N'crm-transfer-deed-date', N'admin,super_admin,dba', N'Transfer Deed — Date Approval'),
  (N'crm-transfer-deeds', N'admin,super_admin,dba', N'Transfer Deed — Legal Head'),
  (N'crm-resales', N'admin,super_admin,dba', N'Property Resale & Buy-back'),
  (N'crm-ownership-changes', N'admin,super_admin,dba', N'Ownership Change'),
  -- Booking approval needs two levels (Marketing Head, then Director); one
  -- is written below separately when missing.
  -- Gates that had their own lists in separate files until now:
  (N'received-payment', N'admin,super_admin,dba,accounts_head,director', N'Received Payment'),
  (N'crm-money-receipts', N'admin,super_admin,dba,accounts_head', N'CRM Money Receipt'),
  (N'crm-refunds-finance', N'accounts_head,finance_head,admin,super_admin', N'CRM Refund — Finance'),
  (N'crm-bank-details-edit', N'admin,super_admin,marketing_head', N'Edit locked customer bank / KYC details'),
  (N'crm-sales-deed-docs', N'admin,super_admin,marketing_head,legal_head', N'Upload sale deed documents (besides the assigned legal executive)');

INSERT INTO dbo.ApprovalWorkflows (Name, type, modules, LevelsData, active, CreatedBy, CreatedAt, Module, Levels, Status)
SELECT s.Label,
       'sequential',
       N'["' + s.Module + N'"]',
       N'[{"id":1,"label":"Approval","mode":"any","userIds":[],"roles":['
         + ISNULL((SELECT STRING_AGG(N'"' + r.RName + N'"', N',') FROM dbo.Role r
                   WHERE N',' + s.Roles + N',' LIKE N'%,' + LOWER(r.RName) + N',%'), N'')
         + N']}]',
       1, N'migration 582', SYSDATETIME(), s.Module, 1, 'Active'
FROM @seed s
WHERE NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows w
                  WHERE w.active = 1 AND w.modules LIKE N'%"' + s.Module + N'"%');

IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE active = 1 AND modules LIKE N'%"crm-bookings"%')
  INSERT INTO dbo.ApprovalWorkflows (Name, type, modules, LevelsData, active, CreatedBy, CreatedAt, Module, Levels, Status)
  VALUES (N'CRM Booking Approval (Marketing Head -> Director)', 'sequential', N'["crm-bookings"]',
          N'[{"id":1,"label":"Marketing Head","mode":"any","roles":["marketing_head"],"userIds":[]},{"id":2,"label":"Director","mode":"any","roles":["director"],"userIds":[]}]',
          1, N'migration 582', SYSDATETIME(), N'crm-bookings', 2, 'Active');
GO
