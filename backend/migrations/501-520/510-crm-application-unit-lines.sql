
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmApplicationUnit' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmApplicationUnit (
    Id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CrmApplicationUnit PRIMARY KEY,
    ApplicationId  INT NOT NULL,
    UnitId         INT NOT NULL,
    AreaSqFt       DECIMAL(18,2) NULL,
    RatePerSqFt    DECIMAL(18,2) NULL,
    PremiumAmount  DECIMAL(18,2) NULL,
    AllocatedValue DECIMAL(18,2) NULL,
    Status         NVARCHAR(30) NOT NULL CONSTRAINT DF_CrmApplicationUnit_Status DEFAULT (N'Active'),
    IsPrimary      BIT NOT NULL CONSTRAINT DF_CrmApplicationUnit_IsPrimary DEFAULT (0),
    CreatedBy      INT NULL,
    CreatedAt      DATETIME2(0) NOT NULL CONSTRAINT DF_CrmApplicationUnit_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy      INT NULL,
    UpdatedAt      DATETIME2(0) NULL,
    CONSTRAINT FK_CrmApplicationUnit_App  FOREIGN KEY (ApplicationId) REFERENCES dbo.CrmApplication(Id),
    CONSTRAINT FK_CrmApplicationUnit_Unit FOREIGN KEY (UnitId)    REFERENCES dbo.UnitMaster(Id)
  );

  CREATE UNIQUE INDEX UX_CrmApplicationUnit_ActiveUnit ON dbo.CrmApplicationUnit(UnitId) WHERE Status = N'Active';
  CREATE NONCLUSTERED INDEX IX_CrmApplicationUnit_App ON dbo.CrmApplicationUnit(ApplicationId) INCLUDE (UnitId, AreaSqFt, AllocatedValue) WHERE Status = N'Active';
END
GO

INSERT INTO dbo.CrmApplicationUnit (ApplicationId, UnitId, Status, IsPrimary, CreatedAt)
SELECT a.Id, a.PreferredUnitId, 
       CASE WHEN a.Status IN (N'Cancelled', N'Rejected', N'Expired') OR ISNULL(a.IsActive, 1) = 0 THEN N'Cancelled' ELSE N'Active' END,
       1, SYSDATETIME()
FROM dbo.CrmApplication a
WHERE a.PreferredUnitId IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.CrmApplicationUnit l WHERE l.ApplicationId = a.Id);
GO
