-- Migration 674: Work Location Master (HR and Payroll > Setup) -- the places employees work from.
-- Each location has a name and code, a GPS point (Latitude/Longitude), the address fetched for that point, and a marked
-- area: a circle around the point with RadiusMeters (the geofence an attendance punch can later be checked against).

IF OBJECT_ID('dbo.WorkLocationMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.WorkLocationMaster (
    LocationId     INT            IDENTITY(1,1) PRIMARY KEY,
    LocationName   NVARCHAR(100)  NOT NULL,
    LocationCode   NVARCHAR(30)   NOT NULL,
    Latitude       DECIMAL(9,6)   NOT NULL,
    Longitude      DECIMAL(9,6)   NOT NULL,
    Address        NVARCHAR(500)  NULL,
    RadiusMeters   INT            NOT NULL CONSTRAINT DF_WorkLocationMaster_Radius DEFAULT 100,
    IsActive       BIT            NOT NULL CONSTRAINT DF_WorkLocationMaster_IsActive DEFAULT 1,
    CreatedBy      INT            NULL,
    CreatedAt      DATETIME2      NOT NULL CONSTRAINT DF_WorkLocationMaster_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy      INT            NULL,
    UpdatedAt      DATETIME2      NULL,
    CONSTRAINT UQ_WorkLocationMaster_Name UNIQUE (LocationName),
    CONSTRAINT UQ_WorkLocationMaster_Code UNIQUE (LocationCode),
    CONSTRAINT CK_WorkLocationMaster_Lat CHECK (Latitude BETWEEN -90 AND 90),
    CONSTRAINT CK_WorkLocationMaster_Lng CHECK (Longitude BETWEEN -180 AND 180),
    CONSTRAINT CK_WorkLocationMaster_Radius CHECK (RadiusMeters BETWEEN 10 AND 100000),
    CONSTRAINT FK_WorkLocationMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_WorkLocationMaster_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'work-location-master')
  UPDATE dbo.PageDefinitions
    SET Label = N'Work Location Master', Module = N'HR and Payroll', GroupName = N'HR and Payroll Masters',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 65, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'work-location-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'work-location-master', N'Work Location Master', N'HR and Payroll', N'HR and Payroll Masters', N'view,create,edit,delete,print,export', 65, 1, N'migration-674', SYSDATETIME());
GO

PRINT '674-work-location-master applied successfully.';
GO
