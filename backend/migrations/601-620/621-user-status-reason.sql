-- Migration 621: why, and by whom, a user was last made active or inactive
--
-- Making a user active / inactive asks for a written reason (PUT /api/users/:id). The reason, the person and the time are kept
-- here so the Users list can show them under the status; the activity log keeps the full history.
IF COL_LENGTH('dbo.users', 'StatusReason') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD StatusReason NVARCHAR(120) NULL;
  PRINT 'Added users.StatusReason';
END
GO
IF COL_LENGTH('dbo.users', 'StatusChangedAt') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD StatusChangedAt DATETIME2 NULL;
  PRINT 'Added users.StatusChangedAt';
END
GO
IF COL_LENGTH('dbo.users', 'StatusChangedBy') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD StatusChangedBy NVARCHAR(200) NULL;
  PRINT 'Added users.StatusChangedBy';
END
GO
