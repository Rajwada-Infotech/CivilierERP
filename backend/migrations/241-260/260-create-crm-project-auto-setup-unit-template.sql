-- Migration 260: dbo.CrmProjectAutoSetupUnitTemplate — a Block's "typical
-- floor" unit mix (e.g. 2x 2BHK + 2x 3BHK), defined once and applied to
-- every non-Ground floor in that Block instead of typing a unit count
-- separately for every single floor. Rows are an ordered sequence
-- (SortOrder) of {UnitType, Count} segments; the flat expansion of that
-- sequence (e.g. [2BHK,2BHK,3BHK,3BHK]) is what generate-units cycles
-- through per floor — see crmProjectAutoSetup.js's POST /generate-units.
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE name = 'CrmProjectAutoSetupUnitTemplate' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.CrmProjectAutoSetupUnitTemplate (
    Id         INT            IDENTITY(1,1) PRIMARY KEY,
    BlockId    INT            NOT NULL,
    SortOrder  INT            NOT NULL,
    UnitType   NVARCHAR(50)   NOT NULL,
    Count      INT            NOT NULL,
    AreaSqFt   DECIMAL(18,2)  NULL,
    IsActive   BIT            NOT NULL CONSTRAINT DF_CPASUT_IsActive DEFAULT (1),
    CreatedBy  INT            NULL,
    CreatedAt  DATETIME2(3)   NOT NULL CONSTRAINT DF_CPASUT_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy  INT            NULL,
    UpdatedAt  DATETIME2(3)   NULL
  );

  CREATE INDEX IX_CrmProjectAutoSetupUnitTemplate_BlockId
    ON dbo.CrmProjectAutoSetupUnitTemplate(BlockId)
    INCLUDE (SortOrder, UnitType, Count, AreaSqFt, IsActive);
END
