-- Migration 674: Maintenance > Key Custodian.
--
-- One record per unit of who holds its keys. The unit's buyer details are not copied here: the page reads them
-- live from the unit's confirmed CRM booking, so a change in CRM shows at once. BookingId records which booking
-- was current when the keys were last recorded.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaintenanceKeyCustodian' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.MaintenanceKeyCustodian (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    UnitId          INT            NOT NULL,
    BookingId       INT            NULL,
    -- Owner / Co-applicant / Developer / Tenant / Caretaker / Other
    CustodianType   NVARCHAR(30)   NOT NULL,
    CustodianName   NVARCHAR(200)  NOT NULL,
    CustodianPhone  NVARCHAR(20)   NULL,
    KeyCount        INT            NULL,
    KeyTagNo        NVARCHAR(50)   NULL,
    HandedOverOn    DATE           NULL,
    HandedOverBy    NVARCHAR(150)  NULL,
    Remarks         NVARCHAR(1000) NULL,
    CreatedBy       NVARCHAR(150)  NULL,
    CreatedAt       DATETIME2(3)   NOT NULL CONSTRAINT DF_MaintenanceKeyCustodian_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy       NVARCHAR(150)  NULL,
    UpdatedAt       DATETIME2(3)   NULL,
    CONSTRAINT UQ_MaintenanceKeyCustodian_Unit UNIQUE (UnitId),
    CONSTRAINT FK_MaintenanceKeyCustodian_Unit FOREIGN KEY (UnitId) REFERENCES dbo.UnitMaster(Id)
  );
  PRINT 'Created dbo.MaintenanceKeyCustodian';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'maintenance-key-custodian' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('maintenance-key-custodian', 'Key Custodian', 'Maintenance', 'Maintenance', 'view,create,edit,delete,print,export', 246, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions maintenance-key-custodian';
END
GO

PRINT '674-maintenance-key-custodian applied successfully.';
GO
