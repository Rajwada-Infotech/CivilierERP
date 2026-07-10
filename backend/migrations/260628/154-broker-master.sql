-- ============================================================
-- Migration 154: Broker Master
-- Brokers become AccountHeadMaster rows (LHeadType = 'BR'), the
-- same pattern Contractors ('C') and Suppliers ('S') already use.
-- CrmBrokerageMaster gains a BrokerId link to that ledger head so
-- brokerage entries can be tied to a real broker account instead
-- of free-typed name/firm/contact text.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'BrokerId')
BEGIN
  ALTER TABLE dbo.CrmBrokerageMaster ADD BrokerId INT NULL REFERENCES dbo.AccountHeadMaster(LHeadId);
  PRINT 'Added BrokerId to CrmBrokerageMaster';
END
GO

-- ── Page Definition — CRM Broker Master (frontend gating only; the actual
-- CRUD API is the shared /api/account-head endpoint, same as Contractors) ──
DECLARE @base INT = 950;

MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('broker-master', 'Broker Master', 'CRM', 'CRM Finance', 'view,create,edit,delete', @base + 5, 1, 'migration-154')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, GETDATE());

PRINT 'Seeded broker-master PageDefinition';
GO
