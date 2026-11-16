-- Migration 637: where a BOQ (estimation) is for — Block, Floor and Room of its project.
-- Block = BlockMaster, Floor = the FloorNo of that block's units (there is no Floor master), Room = RoomMaster.
-- An activity can be estimated only once per project + block + floor + room (enforced in routes/boq.js).
-- Existing BOQs stay blank; new ones must have all three.
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'BOQ' AND COLUMN_NAME = 'BlockId')
  ALTER TABLE dbo.BOQ ADD BlockId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'BOQ' AND COLUMN_NAME = 'FloorNo')
  ALTER TABLE dbo.BOQ ADD FloorNo NVARCHAR(20) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'BOQ' AND COLUMN_NAME = 'RoomId')
  ALTER TABLE dbo.BOQ ADD RoomId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_BOQ_Location' AND object_id = OBJECT_ID('dbo.BOQ'))
  CREATE INDEX IX_BOQ_Location ON dbo.BOQ (ProjectId, BlockId, FloorNo, RoomId) INCLUDE (Status);
GO
