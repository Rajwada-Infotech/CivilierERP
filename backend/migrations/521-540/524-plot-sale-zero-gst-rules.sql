-- Migration 524: no GST on anything collected with a plot (land) sale.
--
-- Business decision (2026-10-02): a plot sale carries 0% GST throughout —
-- the land itself (already outside GST, Schedule III), and also the charges
-- collected with it (development, legal, documentation …) and the developer's
-- fee when a plot is resold. Villas and flats are unchanged.
--
-- Kept as master data like every other rate: one 0% HSN row, and two rules
-- that pick it for plot sales. The engine looks up the *_LAND rule first for
-- a plot sale and falls back to the ordinary rule when none matches, so
-- deactivating one of these rules — or changing the HSN rate — brings GST
-- back for plots without a code change.
-- Safe to re-run.

DECLARE @by INT = (SELECT MIN(id) FROM dbo.users);

IF NOT EXISTS (SELECT 1 FROM dbo.HSN WHERE HCode = 'LANDNIL')
  INSERT INTO dbo.HSN (HCode, HDescription, HShortDescription, HCGST, HSGST, HIGST, HStatus, CreatedBy, CreatedAt)
  VALUES ('LANDNIL', 'Plot (land) sale — charges and resale fee collected with a plot carry no GST (business decision)',
          'Plot sale — no GST', 0, 0, 0, 1, @by, SYSDATETIME());
GO

INSERT INTO dbo.CrmGstRule (Name, AppliesTo, HsnCode, MinValue, MaxValue, LandOwnedByCustomer, Priority, Notes)
SELECT v.Name, v.AppliesTo, v.HsnCode, NULL, NULL, NULL, 10, v.Notes
FROM (VALUES
  (N'Extra charges on a plot sale', 'EXTRA_WORK_LAND', 'LANDNIL',
   N'No GST on charges collected with a plot. Rate in HSN LANDNIL. Without this rule plot charges fall back to EXTRA_WORK.'),
  (N'Developer fee on a plot resale', 'RESALE_FEE_LAND', 'LANDNIL',
   N'No GST on the fee for a plot resale. Rate in HSN LANDNIL. Without this rule it falls back to RESALE_FEE (999794).')
) AS v(Name, AppliesTo, HsnCode, Notes)
WHERE NOT EXISTS (SELECT 1 FROM dbo.CrmGstRule r WHERE r.Name = v.Name);
GO

PRINT 'Migration 524: plot sales carry no GST on charges or resale fee.';
GO
