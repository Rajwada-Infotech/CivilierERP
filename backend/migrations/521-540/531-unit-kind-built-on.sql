-- Migration 531: where a unit kind is built — on a tower's floors, on a plot,
-- or either. Lets a project type with floors offer only floor kinds and a
-- plotted type only plot kinds (no "flat" on a plot, no "villa" on a floor).
--   'FLOORS' | 'PLOTS' | NULL (both — e.g. a shop)
-- Values are data, set from Unit Master › Unit kinds (or scripts/seedMasters.js);
-- NULL keeps today's behaviour.

IF COL_LENGTH('dbo.CrmConstructedAssetKind', 'BuiltOn') IS NULL
BEGIN
  ALTER TABLE dbo.CrmConstructedAssetKind ADD BuiltOn NVARCHAR(10) NULL;
  PRINT 'Migration 531: added CrmConstructedAssetKind.BuiltOn.';
END
GO
