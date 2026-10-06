-- Migration 539: a villa type owns its rooms, floor by floor.
--
-- A villa is the opposite of a tower: the unit contains its floors. Each
-- villa design (VillaTypeMaster) now lists which rooms sit on which of its
-- floors (G, 1, 2, Roof ...):
--
--   dbo.VillaTypeRoomPlan        one row per (villa type, floor, room category)
--   RoomLayoutType.OwnerVillaTypeId  the room layout built FROM that plan
--                                    (rooms summed per category), so the
--                                    existing room engine, sync, overrides and
--                                    DPR keep working unchanged; hidden from
--                                    general layout pickers
--   RoomMaster.Storey            the villa floor a room sits on (NULL for
--                                flats, whose floor is the unit's floor)
--
-- Safe to re-run.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'VillaTypeRoomPlan' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.VillaTypeRoomPlan (
    Id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_VillaTypeRoomPlan PRIMARY KEY,
    VillaTypeId    INT          NOT NULL,
    Storey         NVARCHAR(10) NOT NULL,   -- 'G', '1', '2', 'Roof' ...
    StoreyOrder    INT          NOT NULL,   -- G = 0, 1 = 1 ... (bottom to top)
    RoomCategoryId INT          NOT NULL,
    Quantity       INT          NOT NULL,
    CreatedAt      DATETIME2(0) NOT NULL CONSTRAINT DF_VillaTypeRoomPlan_CreatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT FK_VillaTypeRoomPlan_Type FOREIGN KEY (VillaTypeId) REFERENCES dbo.VillaTypeMaster(Id),
    CONSTRAINT FK_VillaTypeRoomPlan_Category FOREIGN KEY (RoomCategoryId) REFERENCES dbo.RoomCategoryMaster(Id),
    CONSTRAINT CK_VillaTypeRoomPlan_Qty CHECK (Quantity > 0 AND Quantity <= 20)
  );
  CREATE UNIQUE INDEX UX_VillaTypeRoomPlan ON dbo.VillaTypeRoomPlan(VillaTypeId, Storey, RoomCategoryId);
  PRINT 'Migration 539: created dbo.VillaTypeRoomPlan.';
END
ELSE
  PRINT 'Migration 539: dbo.VillaTypeRoomPlan already exists — skipped.';
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.RoomLayoutType') AND name = 'OwnerVillaTypeId')
BEGIN
  ALTER TABLE dbo.RoomLayoutType ADD OwnerVillaTypeId INT NULL;
  PRINT 'Migration 539: added RoomLayoutType.OwnerVillaTypeId.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.RoomMaster') AND name = 'Storey')
BEGIN
  ALTER TABLE dbo.RoomMaster ADD Storey NVARCHAR(10) NULL;
  PRINT 'Migration 539: added RoomMaster.Storey.';
END
GO
