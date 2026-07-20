-- Tag each Daily Labour entry with where in the project the work happened
-- (Block / Unit / Room, from the Follow-up module's masters) so the
-- attendance register can be printed with a precise location.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DailyLabourEntry') AND name = 'BlockId'
)
BEGIN
  ALTER TABLE dbo.DailyLabourEntry ADD BlockId INT NULL;
  ALTER TABLE dbo.DailyLabourEntry ADD CONSTRAINT FK_DailyLabour_Block FOREIGN KEY (BlockId) REFERENCES dbo.BlockMaster(Id);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DailyLabourEntry') AND name = 'UnitId'
)
BEGIN
  ALTER TABLE dbo.DailyLabourEntry ADD UnitId INT NULL;
  ALTER TABLE dbo.DailyLabourEntry ADD CONSTRAINT FK_DailyLabour_Unit FOREIGN KEY (UnitId) REFERENCES dbo.UnitMaster(Id);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DailyLabourEntry') AND name = 'RoomId'
)
BEGIN
  ALTER TABLE dbo.DailyLabourEntry ADD RoomId INT NULL;
  ALTER TABLE dbo.DailyLabourEntry ADD CONSTRAINT FK_DailyLabour_Room FOREIGN KEY (RoomId) REFERENCES dbo.RoomMaster(Id);
END
GO
