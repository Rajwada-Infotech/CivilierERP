-- Migration 464: the previous migration (463) seeded dbo.EngineeringActivityMaster
-- from a snapshot of dbo.ActivityMaster so existing Work Order/BOQ rows kept
-- resolving. In practice every one of those copied rows actually belonged
-- to Civil Work DPR, not Engineering — clearing them out so Engineering
-- starts its own activity list from empty, same as any other brand-new
-- master. dbo.ActivityMaster (Civil Work DPR's) is untouched.

IF EXISTS (SELECT 1 FROM sysobjects WHERE name = 'EngineeringActivityItems' AND xtype = 'U')
  DELETE FROM dbo.EngineeringActivityItems;
GO

IF EXISTS (SELECT 1 FROM sysobjects WHERE name = 'EngineeringActivityMaster' AND xtype = 'U')
  DELETE FROM dbo.EngineeringActivityMaster;
GO

-- Reseed both identities back to 0 so a fresh Engineering Activity Master
-- starts numbering at 1, same as it would have if 463 had never copied
-- anything in.
IF EXISTS (SELECT 1 FROM sysobjects WHERE name = 'EngineeringActivityMaster' AND xtype = 'U')
  DBCC CHECKIDENT ('dbo.EngineeringActivityMaster', RESEED, 0);
GO

IF EXISTS (SELECT 1 FROM sysobjects WHERE name = 'EngineeringActivityItems' AND xtype = 'U')
  DBCC CHECKIDENT ('dbo.EngineeringActivityItems', RESEED, 0);
GO
