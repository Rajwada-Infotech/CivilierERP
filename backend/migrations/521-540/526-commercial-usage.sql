-- Migration 526: residential vs commercial — per unit, per project type, per GST rule.
--
-- A building can be partly commercial (Gloria: shops on ground + first floor,
-- flats above) or wholly commercial. Exactly like land vs construction, the
-- usage is a property of the UNIT (its kind), the project type only says what
-- the project may sell, and the GST master decides the HSN. No kinds, types or
-- rules are seeded here — they are created from the masters in the app. The
-- column defaults keep every existing row behaving exactly as before:
-- every existing kind is non-commercial, every existing type sells residential
-- only, and every existing GST rule ignores usage.

-- 1. Unit kind: is this kind commercial (shop, office…)?
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmConstructedAssetKind') AND name = 'IsCommercial')
BEGIN
  ALTER TABLE dbo.CrmConstructedAssetKind ADD IsCommercial BIT NOT NULL
    CONSTRAINT DF_CrmConstructedAssetKind_IsCommercial DEFAULT (0);
  PRINT 'Migration 526: added CrmConstructedAssetKind.IsCommercial.';
END
GO

-- 2. Project type: may it sell residential / commercial units?
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectTypeMaster') AND name = 'SellsResidential')
BEGIN
  ALTER TABLE dbo.ProjectTypeMaster ADD SellsResidential BIT NOT NULL
    CONSTRAINT DF_ProjectTypeMaster_SellsResidential DEFAULT (1);
  PRINT 'Migration 526: added ProjectTypeMaster.SellsResidential.';
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectTypeMaster') AND name = 'SellsCommercial')
BEGIN
  ALTER TABLE dbo.ProjectTypeMaster ADD SellsCommercial BIT NOT NULL
    CONSTRAINT DF_ProjectTypeMaster_SellsCommercial DEFAULT (0);
  PRINT 'Migration 526: added ProjectTypeMaster.SellsCommercial.';
END
GO

-- 3. GST rule: tri-state usage qualifier, same semantics as LandOwnedByCustomer.
--    NULL = applies to any usage; 1 = commercial units only; 0 = residential only.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmGstRule') AND name = 'ForCommercial')
BEGIN
  ALTER TABLE dbo.CrmGstRule ADD ForCommercial BIT NULL;
  PRINT 'Migration 526: added CrmGstRule.ForCommercial.';
END
GO

-- 4. Page key for the GST Rule master screen (rights are granted per role in the app).
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'crm-gst-rule-master' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('crm-gst-rule-master', 'GST Rules', 'CRM', 'CRM Setup', 'view,create,edit,delete', 880, 1, 'migration-526', SYSDATETIME());
  PRINT 'Migration 526: seeded PageDefinitions row for crm-gst-rule-master.';
END
GO
