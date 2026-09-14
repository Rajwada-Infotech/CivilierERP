-- Per-item alternate UOMs with their own conversion factor — distinct from
-- UOMMaster.UOMCategory/BaseFactor (backend/migrations/221-240/229-*.sql),
-- which only converts between UOMs that share a fixed *physical* category
-- (Weight, Volume, ...). Cement in Bags vs Cubic Ft has no such fixed
-- category-wide ratio (it's a density fact specific to that one item), so
-- each item needs its own tagged UOM list + factor.
--
-- ConversionFactor semantics: 1 unit of UOMCode = ConversionFactor units of
-- the item's own base UOM (Item_Master_Group.M_UOM). E.g. for Cement whose
-- base UOM is Bag, tagging CFT with ConversionFactor = 0.3 means
-- 1 CFT = 0.3 Bag (and inversely, 1 Bag = 1/0.3 CFT).

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ItemUOMAlternate')
BEGIN
  CREATE TABLE dbo.ItemUOMAlternate (
    ItemUOMAlternateId INT IDENTITY(1,1) PRIMARY KEY,
    ItemId UNIQUEIDENTIFIER NOT NULL,
    UOMCode VARCHAR(10) NOT NULL,
    ConversionFactor DECIMAL(18,6) NOT NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_ItemUOMAlternate_Item_UOM UNIQUE (ItemId, UOMCode)
  );
  CREATE INDEX IX_ItemUOMAlternate_ItemId ON dbo.ItemUOMAlternate(ItemId);
END
