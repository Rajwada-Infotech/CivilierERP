-- Constructed asset kinds are configuration, not code. Plot Master conversion
-- uses this master to decide the UnitMaster.UnitKind it creates.

IF OBJECT_ID(N'dbo.CrmConstructedAssetKind', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CrmConstructedAssetKind (
    Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CrmConstructedAssetKind PRIMARY KEY,
    Code NVARCHAR(20) NOT NULL,
    Name NVARCHAR(100) NOT NULL,
    SortOrder INT NOT NULL CONSTRAINT DF_CrmConstructedAssetKind_SortOrder DEFAULT (100),
    IsActive BIT NOT NULL CONSTRAINT DF_CrmConstructedAssetKind_IsActive DEFAULT (1),
    CreatedBy INT NULL,
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_CrmConstructedAssetKind_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2(0) NULL,
    CONSTRAINT UX_CrmConstructedAssetKind_Code UNIQUE (Code)
  );
END;
GO

-- Preserve every existing constructed classification, then establish the
-- legacy values as editable configuration for fresh databases.
MERGE dbo.CrmConstructedAssetKind AS target
USING (
  SELECT Code, MIN(Name) AS Name, MIN(SortOrder) AS SortOrder
  FROM (
    SELECT DISTINCT UnitKind AS Code, UnitKind AS Name, 100 AS SortOrder
    FROM dbo.UnitMaster
    WHERE UnitKind IS NOT NULL AND UnitKind <> N'PLOT'
    UNION ALL SELECT N'FLAT', N'Flat', 10
    UNION ALL SELECT N'VILLA', N'Villa', 20
  ) AS candidates
  GROUP BY Code
) AS source ON target.Code = source.Code
WHEN NOT MATCHED THEN
  INSERT (Code, Name, SortOrder, IsActive, CreatedAt)
  VALUES (source.Code, source.Name, source.SortOrder, 1, SYSDATETIME());
GO

-- 483 limited UnitKind to FLAT/PLOT/VILLA. PLOT remains a system inventory
-- kind, while constructed kinds are now managed in the master above.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_UnitMaster_UnitKind')
  ALTER TABLE dbo.UnitMaster DROP CONSTRAINT CK_UnitMaster_UnitKind;
GO
