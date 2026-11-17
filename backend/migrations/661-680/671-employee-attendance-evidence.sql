-- Migration 671: In / Out evidence on Employee Attendance -- a live camera photo and the device's location.
-- Captured when an employee punches In or Out on the Employee Portal (the browser takes a photo from the camera at that
-- moment, and asks the device for its position). Photos are small JPEG data URLs (the portal shrinks them before
-- sending); coordinates are decimal degrees, accuracy is the device's reported radius in metres. All columns are
-- optional, so punches made elsewhere (the staff Attendance page, HR corrections) are unaffected.

IF COL_LENGTH('dbo.EmployeeAttendance', 'InPhoto') IS NULL
BEGIN
  ALTER TABLE dbo.EmployeeAttendance ADD
    InPhoto        NVARCHAR(MAX) NULL,
    InLatitude     DECIMAL(9,6)  NULL,
    InLongitude    DECIMAL(9,6)  NULL,
    InAccuracyM    INT           NULL,
    OutPhoto       NVARCHAR(MAX) NULL,
    OutLatitude    DECIMAL(9,6)  NULL,
    OutLongitude   DECIMAL(9,6)  NULL,
    OutAccuracyM   INT           NULL;
END
GO
