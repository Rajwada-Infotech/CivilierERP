-- Migration 530: a floor can have its own unit mix ("Own mix") instead of the
-- block's typical floor (CrmProjectAutoSetupUnitTemplate) — e.g. a shops-only
-- ground floor or a penthouse floor. No rows for a floor = it follows the
-- typical floor, exactly as before.

IF OBJECT_ID(N'dbo.CrmProjectAutoSetupFloorMix', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CrmProjectAutoSetupFloorMix (
    Id                   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CrmProjectAutoSetupFloorMix PRIMARY KEY,
    FloorId              INT NOT NULL,
    SortOrder            INT NOT NULL CONSTRAINT DF_CrmPASFloorMix_Sort DEFAULT (1),
    UnitType             NVARCHAR(50) NULL,
    LayoutTypeId         INT NULL,
    UnitKind             NVARCHAR(20) NULL,
    Count                INT NOT NULL,
    CarpetAreaSqFt       DECIMAL(18,2) NULL,
    BuiltUpAreaSqFt      DECIMAL(18,2) NULL,
    SuperBuiltUpAreaSqFt DECIMAL(18,2) NULL,
    OpenTerraceAreaSqFt  DECIMAL(18,2) NULL,
    RatePerSqFt          DECIMAL(18,2) NULL,
    IsActive             BIT NOT NULL CONSTRAINT DF_CrmPASFloorMix_Active DEFAULT (1),
    CreatedBy            INT NULL,
    CreatedAt            DATETIME2(0) NOT NULL CONSTRAINT DF_CrmPASFloorMix_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedAt            DATETIME2(0) NULL
  );
  CREATE NONCLUSTERED INDEX IX_CrmPASFloorMix_Floor ON dbo.CrmProjectAutoSetupFloorMix(FloorId) WHERE IsActive = 1;
  PRINT 'Migration 530: created dbo.CrmProjectAutoSetupFloorMix.';
END
GO
