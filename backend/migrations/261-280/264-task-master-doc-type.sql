-- Migration 264: wire Task Master into the shared TypeOfDoc numbering system
-- (same doc-numbering-scheme master used by Work Order, Purchase Order, GRN,
-- etc. — see backend/utils/docNumberLock.js). "Task" was added as a new
-- linkable module in document-type.js's MODULE_LINKS and
-- TypeOfDocMaster.tsx's LINK_OPTIONS alongside this migration.
--
-- TypeOfDocId is optional: when a caller picks a configured doc type,
-- backend/routes/taskMaster.js locks the next number through
-- lockNextDocNumber() and stores it in TaskNo as usual. When no doc type is
-- selected, TaskNo still falls back to trg_TaskMaster_TaskNo's simple
-- TSK000001 auto-numbering, unchanged.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.TaskMaster') AND name = 'TypeOfDocId'
)
BEGIN
  ALTER TABLE dbo.TaskMaster ADD TypeOfDocId INT NULL;

  ALTER TABLE dbo.TaskMaster
    ADD CONSTRAINT FK_TaskMaster_TypeOfDoc FOREIGN KEY (TypeOfDocId) REFERENCES dbo.TypeOfDoc(TypeOfDocId);

  CREATE INDEX IX_TaskMaster_TypeOfDocId ON dbo.TaskMaster(TypeOfDocId);
END
GO
