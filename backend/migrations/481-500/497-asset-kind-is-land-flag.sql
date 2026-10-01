-- Migration 497: an asset kind declares whether it is LAND. Taxability stops
-- being a string comparison.
--
-- THE BUG THIS CLOSES
-- unitSaleTreatment() decided "is this land?" with `kind === 'PLOT'` — a
-- literal. That was defensible while migration 483's CHECK constraint pinned
-- UnitKind to FLAT/PLOT/VILLA. Migration 492 then dropped that constraint and
-- made kinds an editable master (dbo.CrmConstructedAssetKind), so the literal
-- became a trap:
--
--   add a kind called COMMERCIAL_PLOT, FARM_LAND or AGRI_PLOT from the UI
--     -> isLand resolves FALSE
--     -> GST is charged on a sale of land, which is outside GST entirely
--        (Schedule III, CGST Act)
--     -> the invoice credits Sale of Flat/Parking instead of Sale of Land
--
-- Nothing warns. The sale looks ordinary and the error is only visible when the
-- GST return is reconciled against the P&L.
--
-- THE FIX, and why it is a flag rather than a longer list of literals:
-- the master now carries IsLand, and code branches on THAT. Adding a land-type
-- kind becomes a row with IsLand = 1 and needs no code change — the same
-- behaviour-flag pattern dbo.ProjectTypeMaster already uses (migration 482),
-- where callers read HasFloors/SellsLand and never the type's name.
--
-- Defaulting to 0 is deliberate and is the safe direction: an unflagged kind is
-- treated as taxable construction. Failing the other way would silently
-- zero-rate a real supply, which is the worse error of the two — one
-- under-collects tax the company owes, the other merely over-collects and is
-- visible to the customer immediately.

IF COL_LENGTH('dbo.CrmConstructedAssetKind', 'IsLand') IS NULL
BEGIN
  ALTER TABLE dbo.CrmConstructedAssetKind
    ADD IsLand BIT NOT NULL CONSTRAINT DF_CrmConstructedAssetKind_IsLand DEFAULT (0);
  PRINT 'Migration 497: added CrmConstructedAssetKind.IsLand (default 0 = taxable construction).';
END
ELSE
  PRINT 'Migration 497: CrmConstructedAssetKind.IsLand already exists — skipped.';
GO

-- Existing kinds are explicitly confirmed as construction rather than left to
-- the column default, so the intent is recorded on the rows themselves.
UPDATE dbo.CrmConstructedAssetKind
SET IsLand = 0, UpdatedAt = SYSDATETIME()
WHERE Code IN (N'FLAT', N'VILLA') AND IsLand <> 0;
GO

-- PLOT is registered as a kind in its own right, flagged as land.
--
-- It is NOT a constructed asset, and migration 492 deliberately excluded it for
-- that reason. It is seeded here anyway because this table is what the
-- taxability resolver reads: leaving the one unambiguously-land kind out of the
-- land register would mean the resolver still needed a hardcoded exception for
-- it, which is the exact thing being removed. IsActive = 0 keeps it out of the
-- "what can I build here?" pickers that list constructed kinds, while remaining
-- readable by the resolver.
IF NOT EXISTS (SELECT 1 FROM dbo.CrmConstructedAssetKind WHERE Code = N'PLOT')
BEGIN
  INSERT INTO dbo.CrmConstructedAssetKind (Code, Name, SortOrder, IsActive, IsLand, CreatedAt)
  VALUES (N'PLOT', N'Plot (land)', 1, 0, 1, SYSDATETIME());
  PRINT 'Migration 497: registered PLOT as a land kind (inactive, so it stays out of constructed-kind pickers).';
END
ELSE
BEGIN
  UPDATE dbo.CrmConstructedAssetKind SET IsLand = 1, UpdatedAt = SYSDATETIME() WHERE Code = N'PLOT' AND IsLand <> 1;
  PRINT 'Migration 497: PLOT already present — ensured IsLand = 1.';
END
GO

DECLARE @Land INT = (SELECT COUNT(*) FROM dbo.CrmConstructedAssetKind WHERE IsLand = 1);
DECLARE @Con  INT = (SELECT COUNT(*) FROM dbo.CrmConstructedAssetKind WHERE IsLand = 0);
PRINT CONCAT('Migration 497 done. Land kinds: ', @Land, ', construction kinds: ', @Con,
             '. Flag any further land-type kind with IsLand = 1 — no code change is needed.');
GO
