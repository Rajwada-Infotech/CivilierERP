-- Migration 328: Task Master reference fields for Entry Type / Type of Doc —
-- lets a task be tagged against any Entry Type (dbo.Entry_Type, the same
-- admin-setup master every module's document numbering is built on) and,
-- once an Entry Type is picked, any Type of Doc under it from ANY module
-- (dbo.TypeOfDoc, unfiltered by module — see backend/routes/document-type.js
-- GET / with no ?module= param). Purely a reference/tagging link; it does
-- not drive the task's own TaskNo numbering (TypeOfDocId already does that).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.TaskMaster') AND name = 'EntryTypeId'
)
BEGIN
  ALTER TABLE dbo.TaskMaster ADD EntryTypeId UNIQUEIDENTIFIER NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.TaskMaster') AND name = 'LinkedTypeOfDocId'
)
BEGIN
  ALTER TABLE dbo.TaskMaster ADD LinkedTypeOfDocId INT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TaskMaster_EntryType'
)
BEGIN
  ALTER TABLE dbo.TaskMaster
    ADD CONSTRAINT FK_TaskMaster_EntryType FOREIGN KEY (EntryTypeId) REFERENCES dbo.Entry_Type(E_Id);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TaskMaster_LinkedTypeOfDoc'
)
BEGIN
  ALTER TABLE dbo.TaskMaster
    ADD CONSTRAINT FK_TaskMaster_LinkedTypeOfDoc FOREIGN KEY (LinkedTypeOfDocId) REFERENCES dbo.TypeOfDoc(TypeOfDocId);
END
GO
