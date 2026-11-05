-- Migration 535: record who added each user.
-- Home › Recent Activity shows "User added — <name>" with a "By" column, but dbo.users had
-- no creator to show (the feed hard-coded NULL). POST /api/users now stores the signed-in
-- admin's id here. Users added before this migration stay NULL — nothing records who
-- created them, so they keep showing "—".

IF COL_LENGTH('dbo.users', 'CreatedBy') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD CreatedBy INT NULL;
  PRINT 'Migration 535: added users.CreatedBy.';
END
GO
