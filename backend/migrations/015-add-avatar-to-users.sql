-- Migration 015: Add avatar storage to users table
-- Stores avatar as a base64 data URI (max ~500KB image)

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'avatar_url'
)
BEGIN
  ALTER TABLE dbo.users
    ADD avatar_url NVARCHAR(MAX) NULL;
  PRINT 'Added avatar_url column to dbo.users';
END
ELSE
BEGIN
  PRINT 'avatar_url column already exists on dbo.users — skipping';
END
