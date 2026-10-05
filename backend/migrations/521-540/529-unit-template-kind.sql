-- Migration 529: a unit-mix row can be a commercial kind (Shop, Office…)
-- instead of a BHK layout. NULL keeps today's meaning (a residential layout).

IF COL_LENGTH('dbo.CrmProjectAutoSetupUnitTemplate', 'UnitKind') IS NULL
BEGIN
  ALTER TABLE dbo.CrmProjectAutoSetupUnitTemplate ADD UnitKind NVARCHAR(20) NULL;
  PRINT 'Migration 529: added CrmProjectAutoSetupUnitTemplate.UnitKind.';
END
GO
