-- ProjectUnitTypeSpec: project-level defaults for area breakdown and base rate
-- per unit type. Sits one tier above BlockUnitTypeSpec in the inheritance chain:
--   Project spec  →  Block spec  →  Unit (explicit override, rare)
-- Staff define it once when a project is created; all blocks in the project
-- inherit it automatically. A block whose unit mix differs (different footprint,
-- different floor plate) overrides at the Block level only.
IF NOT EXISTS (
  SELECT 1 FROM sys.objects
  WHERE object_id = OBJECT_ID(N'dbo.ProjectUnitTypeSpec') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.ProjectUnitTypeSpec (
    Id                   INT IDENTITY(1,1) PRIMARY KEY,
    ProjectId            INT NOT NULL,
    UnitType             NVARCHAR(50) NOT NULL,
    CarpetAreaSqFt       DECIMAL(18,2) NULL,
    BuiltUpAreaSqFt      DECIMAL(18,2) NULL,
    SuperBuiltUpAreaSqFt DECIMAL(18,2) NULL,
    OpenTerraceAreaSqFt  DECIMAL(18,2) NULL,
    BaseRatePerSqFt      DECIMAL(18,2) NULL,
    CreatedAt            DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt            DATETIME2(3) NULL
  );

  CREATE UNIQUE INDEX UX_ProjectUnitTypeSpec_ProjectType
    ON dbo.ProjectUnitTypeSpec (ProjectId, UnitType);
END

-- Backfill: seed one project-level spec per distinct Project+UnitType from
-- existing BlockUnitTypeSpec data (via BlockMaster.ProjectId).
-- MAX() is correct — for a well-configured project all blocks of the same
-- type have the same areas; if they differ, MAX gives the dominant value and
-- the per-block override in BlockUnitTypeSpec keeps the exception accurate.
EXEC (N'
  INSERT INTO dbo.ProjectUnitTypeSpec
    (ProjectId, UnitType, CarpetAreaSqFt, BuiltUpAreaSqFt,
     SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, BaseRatePerSqFt)
  SELECT
    bm.ProjectId,
    s.UnitType,
    MAX(s.CarpetAreaSqFt),
    MAX(s.BuiltUpAreaSqFt),
    MAX(s.SuperBuiltUpAreaSqFt),
    MAX(s.OpenTerraceAreaSqFt),
    MAX(s.BaseRatePerSqFt)
  FROM dbo.BlockUnitTypeSpec s
  JOIN dbo.BlockMaster bm ON bm.Id = s.BlockId
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.ProjectUnitTypeSpec p
    WHERE p.ProjectId = bm.ProjectId AND p.UnitType = s.UnitType
  )
  GROUP BY bm.ProjectId, s.UnitType;
');
