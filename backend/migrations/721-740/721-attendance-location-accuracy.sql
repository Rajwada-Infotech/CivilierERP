-- Attendance movement: stop false "outside office" trips caused by GPS drift.
--   EmployeeLocationPoint      every location point the app sends, with its accuracy, the distance to the nearest own
--                              work location, that location's radius and how the point was classified (audit trail).
--   EmployeeAttendanceMovement + ConfirmNote (why a trip was confirmed), AutoDismissed / DismissNote (a very short
--                              trip treated as GPS drift — not asked, not flagged).
-- Existing very short outside trips (under 3 minutes, no reason yet) are dismissed so employees stop being asked.
IF OBJECT_ID('dbo.EmployeeLocationPoint', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmployeeLocationPoint (
    PointId     BIGINT IDENTITY(1,1) CONSTRAINT PK_EmployeeLocationPoint PRIMARY KEY,
    AttendanceId INT NOT NULL CONSTRAINT FK_EmployeeLocationPoint_Attendance REFERENCES dbo.EmployeeAttendance (AttendanceId) ON DELETE CASCADE,
    EmployeeId  INT NOT NULL,
    Lat         DECIMAL(9,6) NOT NULL,
    Lng         DECIMAL(9,6) NOT NULL,
    AccuracyM   DECIMAL(9,1) NULL,
    PointAt     DATETIME2(0) NOT NULL,
    ReceivedAt  DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeLocationPoint_Received DEFAULT SYSUTCDATETIME(),
    LocationId  INT NULL,          -- nearest own work location
    DistanceM   DECIMAL(9,1) NULL, -- to that location's centre
    RadiusM     INT NULL,
    Result      NVARCHAR(20) NOT NULL, -- Inside / Outside / Uncertain / Office / LowAccuracy / Jump / Ignored
    Note        NVARCHAR(300) NULL,
    MovementId  INT NULL
  );
  CREATE INDEX IX_EmployeeLocationPoint_Attendance ON dbo.EmployeeLocationPoint (AttendanceId, PointAt, PointId);
  CREATE INDEX IX_EmployeeLocationPoint_Employee ON dbo.EmployeeLocationPoint (EmployeeId, PointAt);
END
GO
IF COL_LENGTH('dbo.EmployeeAttendanceMovement', 'ConfirmNote') IS NULL
  ALTER TABLE dbo.EmployeeAttendanceMovement ADD ConfirmNote NVARCHAR(400) NULL,
    AutoDismissed BIT NOT NULL CONSTRAINT DF_EmployeeAttendanceMovement_AutoDismissed DEFAULT 0, DismissNote NVARCHAR(300) NULL;
GO
UPDATE dbo.EmployeeAttendanceMovement
SET AutoDismissed = 1, DismissNote = N'Under 3 minutes outside — treated as GPS drift (before the accuracy checks existed)'
WHERE Kind = N'Outside' AND EndAt IS NOT NULL AND HasVisit = 0 AND Reason IS NULL AND AutoDismissed = 0
  AND DATEDIFF(second, StartAt, EndAt) < 180;
GO
