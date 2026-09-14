-- Per-user preference: show the "reminders" popup right after login. Users
-- can turn this off from their Profile page; defaults to on for everyone.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.users') AND name = 'ShowLoginReminders'
)
  ALTER TABLE dbo.users ADD ShowLoginReminders BIT NOT NULL DEFAULT 1;
