-- 696: On-duty movement for Employee Portal punches. Schema only; safe to re-run.
--  The app reports its location after each 100 m move while the employee is punched in. Each row is one trip:
--  • Kind 'Outside': left all of the employee's own work locations without a break running. Closed when they are back
--    at their own location; the employee then gives the reason (Reason). HasVisit = an office visit happened during it,
--    so no reason is asked (a known office is work).
--  • Kind 'Visit': inside another Work Location Master office — entry (StartAt) and exit (EndAt).
-- HR tables in this database have no tenant key (one database per deployment), so none is added here.
IF OBJECT_ID('dbo.EmployeeAttendanceMovement', 'U') IS NULL
CREATE TABLE dbo.EmployeeAttendanceMovement (
  MovementId   INT IDENTITY(1,1) CONSTRAINT PK_EmployeeAttendanceMovement PRIMARY KEY,
  AttendanceId INT NOT NULL CONSTRAINT FK_EmployeeAttendanceMovement_Attendance REFERENCES dbo.EmployeeAttendance (AttendanceId) ON DELETE CASCADE,
  EmployeeId   INT NOT NULL,
  Kind         NVARCHAR(20) NOT NULL,
  LocationId   INT NULL CONSTRAINT FK_EmployeeAttendanceMovement_Location REFERENCES dbo.WorkLocationMaster (LocationId),
  StartAt      DATETIME2(0) NOT NULL,
  EndAt        DATETIME2(0) NULL,
  StartLat     DECIMAL(9,6) NULL,
  StartLng     DECIMAL(9,6) NULL,
  HasVisit     BIT NOT NULL CONSTRAINT DF_EmployeeAttendanceMovement_HasVisit DEFAULT 0,
  Reason       NVARCHAR(500) NULL,
  ReasonAt     DATETIME2(0) NULL,
  CreatedAt    DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeAttendanceMovement_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_EmployeeAttendanceMovement_Kind CHECK (Kind IN (N'Outside', N'Visit'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EmployeeAttendanceMovement_Attendance')
  CREATE INDEX IX_EmployeeAttendanceMovement_Attendance ON dbo.EmployeeAttendanceMovement (AttendanceId, StartAt);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EmployeeAttendanceMovement_Employee')
  CREATE INDEX IX_EmployeeAttendanceMovement_Employee ON dbo.EmployeeAttendanceMovement (EmployeeId, StartAt DESC);
GO
