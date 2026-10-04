-- Migration 457: Material Issue Return gains real approval gating.
-- Previously this module hand-rolled its own Draft/Pending/Approved/Rejected
-- cycle with plain UPDATEs (backend/routes/issueReturn.js), never went
-- through the shared approvalService.js transition() engine, and never
-- auto-submitted on create — every return needed a manual "Submit for
-- approval" click and a manual "Approve" click, both from this module's own
-- page rather than the centralized Approval Inbox, so a multi-level workflow
-- configured for it in Approval Setup had nothing to actually gate.
--
-- PostedToStock tracks whether the credit-back StockLedger IN rows have been
-- written yet, so posting can safely move to final-approval time (mirrors
-- dbo.StockTransfers.PostedToStock / migration 455, dbo.SaleOrders.PostedToStock)
-- without risking a double post if an approve request is retried.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialIssueReturn') AND name = 'PostedToStock')
  ALTER TABLE dbo.MaterialIssueReturn ADD PostedToStock BIT NOT NULL CONSTRAINT DF_MaterialIssueReturn_PostedToStock DEFAULT 0;
GO

-- Every pre-existing Approved row already moved its stock at approval time
-- under the old code path — back-fill them as posted so they aren't
-- mistaken for awaiting-approval returns that still need their ledger rows
-- written (which would double-credit the stock on next save).
UPDATE dbo.MaterialIssueReturn SET PostedToStock = 1 WHERE Status = 'Approved';
GO

PRINT '457-material-issue-return-approval-gating applied successfully.';
GO
