-- Fixed-Asset-type GRN purchases were posting entirely to Purchase A/c (an
-- expense-side head) with nowhere else to go, so they never showed up under
-- the FIXED ASSETS group (AGId 31) in Trial Balance or the Balance Sheet —
-- see backend/services/generalLedger.js's postGRNApproval, which now debits
-- this head for any GRN line whose Item Master item is tagged
-- M_Type='Fixed Asset' (or the item's own M_GLHeadId tag, when set).
--
-- Seeded under AGId 31 (FIXED ASSETS) directly, matching migration 237's
-- pattern of a same-shape system GL head insert.

IF NOT EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster
  WHERE LHeadName = 'Fixed Assets A/c' AND LHeadType = 'GL'
)
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms,
     LBranchName, LCountry, LBelongsTo, IsSystemGenerated)
  VALUES
    ('Fixed Assets A/c', 'FIXAST', 'GL', 1,
     'N/A', 'N/A', 'N/A',
     'Main', 'India', 31, 1);
  PRINT 'Seeded: Fixed Assets A/c';
END
ELSE
BEGIN
  UPDATE dbo.AccountHeadMaster
    SET IsSystemGenerated = 1
  WHERE LHeadName = 'Fixed Assets A/c' AND LHeadType = 'GL';
  PRINT 'Updated IsSystemGenerated for: Fixed Assets A/c';
END
