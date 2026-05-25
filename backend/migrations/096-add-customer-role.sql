-- Migration: Add customer role and demo user
-- Safe to run: uses IF NOT EXISTS guards

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RName = 'customer')
BEGIN
  INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
  VALUES ('customer', 'CST', 'Customer Portal User', 'system');
END

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE email = 'customer@civilier.com')
BEGIN
  INSERT INTO dbo.users (name, email, password, RoleId, discontinue)
  SELECT 'Customer Demo', 'customer@civilier.com',
         '\\\/tLw4mj8up2foMfGVrMCpPz9ToD7H3RQ3EPRUX4W',
         RId, 0
  FROM dbo.Role WHERE RName = 'customer';
END
