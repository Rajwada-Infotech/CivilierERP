-- Migration 325: Task Master subtasks — a task can optionally reference a
-- parent task, making it a subtask. Self-referencing FK, one level deep
-- (parent tasks can have subtasks, subtasks are not further nested by the
-- UI, though the schema doesn't hard-block it).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.TaskMaster') AND name = 'ParentTaskId'
)
BEGIN
  ALTER TABLE dbo.TaskMaster ADD ParentTaskId INT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TaskMaster_ParentTask'
)
BEGIN
  ALTER TABLE dbo.TaskMaster
    ADD CONSTRAINT FK_TaskMaster_ParentTask FOREIGN KEY (ParentTaskId) REFERENCES dbo.TaskMaster(Id);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_TaskMaster_ParentTaskId'
)
BEGIN
  CREATE INDEX IX_TaskMaster_ParentTaskId ON dbo.TaskMaster(ParentTaskId);
END
GO
