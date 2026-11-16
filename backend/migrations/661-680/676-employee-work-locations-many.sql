-- Migration 676: an employee can be tagged to several Work Locations.
-- Replaces the single EmployeeMaster.WorkLocationId (migration 675) with a link table, EmployeeWorkLocation. Any location
-- already chosen is carried over before the old column is dropped.

IF OBJECT_ID('dbo.EmployeeWorkLocation', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmployeeWorkLocation (
    EmployeeId  INT NOT NULL,
    LocationId  INT NOT NULL,
    CONSTRAINT PK_EmployeeWorkLocation PRIMARY KEY (EmployeeId, LocationId),
    CONSTRAINT FK_EmployeeWorkLocation_Employee FOREIGN KEY (EmployeeId) REFERENCES dbo.EmployeeMaster (EmployeeId) ON DELETE CASCADE,
    CONSTRAINT FK_EmployeeWorkLocation_Location FOREIGN KEY (LocationId) REFERENCES dbo.WorkLocationMaster (LocationId)
  );
  CREATE INDEX IX_EmployeeWorkLocation_Location ON dbo.EmployeeWorkLocation (LocationId);
END
GO

IF COL_LENGTH('dbo.EmployeeMaster', 'WorkLocationId') IS NOT NULL
BEGIN
  EXEC sp_executesql N'
    INSERT INTO dbo.EmployeeWorkLocation (EmployeeId, LocationId)
    SELECT e.EmployeeId, e.WorkLocationId FROM dbo.EmployeeMaster e
    WHERE e.WorkLocationId IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM dbo.EmployeeWorkLocation x WHERE x.EmployeeId = e.EmployeeId AND x.LocationId = e.WorkLocationId);';
  IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_EmployeeMaster_WorkLocation')
    ALTER TABLE dbo.EmployeeMaster DROP CONSTRAINT FK_EmployeeMaster_WorkLocation;
  ALTER TABLE dbo.EmployeeMaster DROP COLUMN WorkLocationId;
END
GO

PRINT '676-employee-work-locations-many applied successfully.';
GO
