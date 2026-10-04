-- Migration 521: GST master data for the plot -> villa -> resale lifecycle.
--
-- Everything here is DATA the GST engine reads at run time: which HSN applies
-- comes from dbo.CrmGstRule, and every RATE comes from dbo.HSN. Changing a
-- rate is an edit of the HSN row; changing which HSN applies is an edit of the
-- rule row. No code holds these numbers.
--
-- Sources: research report "GST on plotted land and villas" (Oct 2026).
--   * Sale of a plot (land) is outside GST — Schedule III para 5, CBIC Circular
--     177/09/2022 para 14, Gujarat HC Munjaal Manishbhai Bhatt (2022). Nothing
--     is seeded for it: the engine treats plot lines as land structurally.
--   * A villa built by the developer on a plot it sold to the buyer, under a
--     separate construction agreement, is treated by the AARs as construction
--     of a residential property: 1% affordable / 5% other, no ITC
--     (Karnataka AAR Varaha Land, KAR ADRG 19/2026; Kerala AAR Prime Property).
--     Rulings bind only their applicants — the CA confirms. If the CA decides
--     on a works contract at 18% with ITC, edit the two villa HSN rows below.
--   * The developer's fee on a resale / transfer of a plot: 18%, SAC 999794
--     (agreeing to tolerate an act) — AAR AP, Maharashtra AAAR Monalisa CHS.
-- Safe to re-run: every insert is guarded.

-- ── HSN rows (the rates) ────────────────────────────────────────────────────
DECLARE @by INT = (SELECT MIN(id) FROM dbo.users);

IF NOT EXISTS (SELECT 1 FROM dbo.HSN WHERE HCode = '9954VAF')
  INSERT INTO dbo.HSN (HCode, HDescription, HShortDescription, HCGST, HSGST, HIGST, HStatus, CreatedBy, CreatedAt)
  VALUES ('9954VAF', 'SAC 995411 - Villa built on the buyer''s own plot, affordable band (no ITC)', 'Villa on own plot - affordable', 0.5, 0.5, 1, 1, @by, SYSDATETIME());

IF NOT EXISTS (SELECT 1 FROM dbo.HSN WHERE HCode = '9954VOT')
  INSERT INTO dbo.HSN (HCode, HDescription, HShortDescription, HCGST, HSGST, HIGST, HStatus, CreatedBy, CreatedAt)
  VALUES ('9954VOT', 'SAC 995411 - Villa built on the buyer''s own plot, other residential (no ITC)', 'Villa on own plot - other', 2.5, 2.5, 5, 1, @by, SYSDATETIME());

IF NOT EXISTS (SELECT 1 FROM dbo.HSN WHERE HCode = '999794')
  INSERT INTO dbo.HSN (HCode, HDescription, HShortDescription, HCGST, HSGST, HIGST, HStatus, CreatedBy, CreatedAt)
  VALUES ('999794', 'SAC 999794 - Agreeing to do or tolerate an act: developer''s plot resale / transfer fee', 'Resale / transfer fee', 9, 9, 18, 1, @by, SYSDATETIME());
GO

-- ── Rules (which HSN applies) ───────────────────────────────────────────────
-- The villa rules are UNIT_PARKING rules that demand LandOwnedByCustomer = 1.
-- The resolver ranks an explicit land-ownership match above a rule that
-- ignores it, so a villa on the buyer's own plot takes these and a flat (or a
-- villa sold with its land) keeps the ordinary bands. Same Rs 45 lakh band as
-- the flat rules — edit MaxValue / MinValue here if the threshold moves.
INSERT INTO dbo.CrmGstRule (Name, AppliesTo, HsnCode, MinValue, MaxValue, LandOwnedByCustomer, Priority, Notes)
SELECT v.Name, v.AppliesTo, v.HsnCode, v.MinValue, v.MaxValue, v.LandOwnedByCustomer, v.Priority, v.Notes
FROM (VALUES
  (N'Villa on the buyer''s own plot — affordable band', 'UNIT_PARKING', '9954VAF', CAST(NULL AS DECIMAL(18,2)), CAST(4500000 AS DECIMAL(18,2)), CAST(1 AS BIT), 10,
   N'Construction-only villa booking on a plot the buyer already owns. Rate in HSN 9954VAF. CA to confirm vs works contract 18%.'),
  (N'Villa on the buyer''s own plot — other residential', 'UNIT_PARKING', '9954VOT', CAST(4500000 AS DECIMAL(18,2)), CAST(NULL AS DECIMAL(18,2)), CAST(1 AS BIT), 20,
   N'As above, above the Rs 45 lakh band. Rate in HSN 9954VOT.'),
  (N'Developer fee on a plot resale / transfer', 'RESALE_FEE', '999794', CAST(NULL AS DECIMAL(18,2)), CAST(NULL AS DECIMAL(18,2)), CAST(NULL AS BIT), 10,
   N'The only developer income in a resale; the land price passes between the buyers outside GST. Rate in HSN 999794.')
) AS v(Name, AppliesTo, HsnCode, MinValue, MaxValue, LandOwnedByCustomer, Priority, Notes)
WHERE NOT EXISTS (SELECT 1 FROM dbo.CrmGstRule r WHERE r.Name = v.Name);
GO

-- ── The resale records which HSN and rate taxed its fee ─────────────────────
-- Snapshotted at the time of the resale so a later HSN edit cannot restate a
-- fee that was already charged.
IF COL_LENGTH('dbo.CrmUnitResale', 'DeveloperFeeHsnCode') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD DeveloperFeeHsnCode VARCHAR(20) NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'DeveloperFeeGstRate') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD DeveloperFeeGstRate DECIMAL(5,2) NULL;
GO

DECLARE @n INT = (SELECT COUNT(*) FROM dbo.CrmGstRule WHERE IsActive = 1);
PRINT CONCAT('Migration 521 done. Active GST rules: ', @n, '.');
GO
