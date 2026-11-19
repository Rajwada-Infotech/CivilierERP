-- 697: Location switched off while on duty. Schema only; safe to re-run.
--  EmployeeAttendanceMovement gets Kind 'LocationOff' (from when the phone's location was off until it was on again) and
--  Skipped (the employee closed the reason popup without a reason — highlighted for HR).
IF COL_LENGTH('dbo.EmployeeAttendanceMovement', 'Skipped') IS NULL
  ALTER TABLE dbo.EmployeeAttendanceMovement ADD Skipped BIT NOT NULL CONSTRAINT DF_EmployeeAttendanceMovement_Skipped DEFAULT 0;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EmployeeAttendanceMovement_Kind'
           AND definition NOT LIKE '%LocationOff%')
  ALTER TABLE dbo.EmployeeAttendanceMovement DROP CONSTRAINT CK_EmployeeAttendanceMovement_Kind;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EmployeeAttendanceMovement_Kind')
  ALTER TABLE dbo.EmployeeAttendanceMovement ADD CONSTRAINT CK_EmployeeAttendanceMovement_Kind CHECK (Kind IN (N'Outside', N'Visit', N'LocationOff'));
GO
