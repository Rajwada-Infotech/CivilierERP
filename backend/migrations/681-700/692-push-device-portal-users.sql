-- Migration 692: phones signed in to the Customer Portal (the Maintenance app's customer side) can receive push
-- notifications too. A phone token belongs to a staff user (UserId) or to a customer portal login (PortalUserId,
-- dbo.CrmCustomerPortalUser) — never both.
-- Safe to run again.
IF COL_LENGTH('dbo.PushDeviceToken', 'PortalUserId') IS NULL
  ALTER TABLE dbo.PushDeviceToken ADD PortalUserId INT NULL;
GO

-- UserId becomes optional (a customer's phone has none); its index is rebuilt around the change.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PushDeviceToken') AND name = 'UserId' AND is_nullable = 0)
BEGIN
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PushDeviceToken_User' AND object_id = OBJECT_ID('dbo.PushDeviceToken'))
    DROP INDEX IX_PushDeviceToken_User ON dbo.PushDeviceToken;
  ALTER TABLE dbo.PushDeviceToken ALTER COLUMN UserId INT NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PushDeviceToken_User' AND object_id = OBJECT_ID('dbo.PushDeviceToken'))
  CREATE INDEX IX_PushDeviceToken_User ON dbo.PushDeviceToken (UserId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PushDeviceToken_PortalUser' AND object_id = OBJECT_ID('dbo.PushDeviceToken'))
  CREATE INDEX IX_PushDeviceToken_PortalUser ON dbo.PushDeviceToken (PortalUserId) WHERE PortalUserId IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PushDeviceToken_Owner')
  ALTER TABLE dbo.PushDeviceToken ADD CONSTRAINT CK_PushDeviceToken_Owner
    CHECK ((UserId IS NOT NULL AND PortalUserId IS NULL) OR (UserId IS NULL AND PortalUserId IS NOT NULL));
GO

PRINT 'Migration 692: dbo.PushDeviceToken.PortalUserId (customer portal phones).';
GO
