-- Migration 332: Progress % on TaskMaster (0-100), manually set per task/
-- sub-task via a drag slider in the Follow-Up drawer/board. Reusing the
-- existing TaskMaster row — no separate progress table.
--
-- Backfill: tasks already Closed read as 100% complete (a closed task
-- showing 0% would look broken in the new progress bar/reports); anything
-- else defaults to 0, same as the column default for new rows.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TaskMaster') AND name = 'Progress'
)
BEGIN
  ALTER TABLE dbo.TaskMaster ADD Progress INT NOT NULL CONSTRAINT DF_TaskMaster_Progress DEFAULT 0;
END
GO

-- Separate batch — a CHECK constraint referencing a column added by the
-- ALTER TABLE above must not share a batch with it, or SQL Server's
-- pre-execution column resolution fails with "Invalid column name".
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TaskMaster_Progress')
BEGIN
  ALTER TABLE dbo.TaskMaster
    ADD CONSTRAINT CK_TaskMaster_Progress CHECK (Progress BETWEEN 0 AND 100);
END
GO

UPDATE dbo.TaskMaster SET Progress = 100 WHERE Status = 'Closed' AND Progress <> 100;
GO
