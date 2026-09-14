-- Repairs POs that were created before the fix in routes/purchaseOrders.js
-- (PurchaseOrders POST route). The old flow inserted a PO as 'Draft' and then
-- made a *separate* post-commit call to transition it to 'Pending'. If that
-- second call failed for any reason (lock contention, transient DB error,
-- etc.) it was swallowed with just a console.warn, leaving the PO stuck on
-- 'Draft' forever with a stray manual "Submit" button — even though the
-- create API response had already told the client Status: "Pending".
--
-- The fix makes the insert and the submit audit-log entry part of one
-- atomic transaction, so this can't happen for new POs. This migration
-- one-time-repairs any POs that were already left in that broken state.

-- Move stuck rows to Pending
UPDATE dbo.PurchaseOrders
SET Status = 'Pending'
WHERE Status IN ('Draft', '') OR Status IS NULL;

-- Backfill the missing level-0 (submission) audit log entry for any of those
-- rows that don't already have one, so ApprovalStatusChain / the audit trail
-- reflects that they were submitted.
INSERT INTO dbo.ApprovalAuditLog
    (TableName, RecordId, Level, Role, ApproverEmail, ActionStatus, Note, ActionAt)
SELECT
    'PurchaseOrders',
    po.PurchaseOrderID,
    0,
    NULL,
    po.CreatedBy,
    'Pending',
    'Backfilled by migration 158 — repair for auto-submit failing silently',
    ISNULL(po.CreatedAt, SYSDATETIME())
FROM dbo.PurchaseOrders po
WHERE po.Status = 'Pending'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.ApprovalAuditLog al
    WHERE al.TableName = 'PurchaseOrders'
      AND al.RecordId = po.PurchaseOrderID
      AND al.Level = 0
  );
