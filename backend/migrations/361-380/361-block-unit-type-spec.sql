-- BlockUnitTypeSpec: the authoritative source for area breakdown per unit type per block.
-- A "2 BHK in Tower A" has one RERA-registered Carpet/Built-up/SBU area regardless
-- of which floor or unit number it is. Putting this at the Block+UnitType level means
-- staff enter it once here; Unit Master shows it as inherited display; Booking
-- snapshots it at booking creation time via the unit's own stamped row.
IF NOT EXISTS (
  SELECT 1 FROM sys.objects
  WHERE object_id = OBJECT_ID(N'dbo.BlockUnitTypeSpec') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.BlockUnitTypeSpec (
    Id                   INT IDENTITY(1,1) PRIMARY KEY,
    BlockId              INT NOT NULL,
    UnitType             NVARCHAR(50) NOT NULL,
    CarpetAreaSqFt       DECIMAL(18,2) NULL,
    BuiltUpAreaSqFt      DECIMAL(18,2) NULL,
    SuperBuiltUpAreaSqFt DECIMAL(18,2) NULL,
    OpenTerraceAreaSqFt  DECIMAL(18,2) NULL,
    BaseRatePerSqFt      DECIMAL(18,2) NULL,
    CreatedAt            DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt            DATETIME2(3) NULL
  );

  -- One spec row per unit type per block — no duplicates.
  CREATE UNIQUE INDEX UX_BlockUnitTypeSpec_BlockType
    ON dbo.BlockUnitTypeSpec (BlockId, UnitType);
END

-- Backfill: seed one spec row per distinct Block+UnitType combination from
-- existing UnitMaster data so already-generated projects get specs immediately.
-- Uses MAX() as the aggregate — for a correctly set-up project all units of the
-- same type in the same block have identical areas, so MAX = the one correct value.
-- Uses EXEC so this UPDATE compiles in a fresh sub-batch after the DDL above.
EXEC (N'
  INSERT INTO dbo.BlockUnitTypeSpec
    (BlockId, UnitType, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, BaseRatePerSqFt)
  SELECT
    BlockId,
    UnitType,
    MAX(CarpetAreaSqFt),
    MAX(BuiltUpAreaSqFt),
    MAX(COALESCE(SuperBuiltUpAreaSqFt, AreaSqFt)),
    MAX(OpenTerraceAreaSqFt),
    MAX(RatePerSqFt)
  FROM dbo.UnitMaster
  WHERE UnitType IS NOT NULL
    AND IsActive = 1
    AND COALESCE(SuperBuiltUpAreaSqFt, AreaSqFt, CarpetAreaSqFt, BuiltUpAreaSqFt) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM dbo.BlockUnitTypeSpec s
      WHERE s.BlockId = dbo.UnitMaster.BlockId AND s.UnitType = dbo.UnitMaster.UnitType
    )
  GROUP BY BlockId, UnitType;
');
