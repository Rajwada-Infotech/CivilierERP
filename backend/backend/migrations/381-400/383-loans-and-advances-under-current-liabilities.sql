-- The LOANS AND ADVANCES group (AGId 79, Code LNA) is deliberately parentless
-- in dbo.AccountGroup — it houses both loan-given (asset) and loan-taken
-- (liability) heads under one umbrella, and the Balance Sheet
-- (financialStatements.js, LOANS_GROUP_ID) already re-buckets each head into
-- Assets or Liabilities by its own Dr/Cr sign, independent of ParentGroupId.
--
-- The Trial Balance report (trialBalance.js) has no such special-casing — it
-- renders whatever tree dbo.AccountGroup's ParentGroupId column describes.
-- Being parentless made LNA render as its own top-level group, a sibling of
-- LIABILITIES itself, instead of folding into Current Liabilities where its
-- (in practice, entirely loan-taken/liability-side) heads actually belong.
--
-- Reparenting under CURRENT LIABILITIES (AGId 8) fixes the Trial Balance's
-- generic tree render. Safe for the Balance Sheet too: its LOANS_GROUP_ID
-- branch matches on the hardcoded group id, not on ParentGroupId, so this
-- change doesn't touch that logic at all.

UPDATE dbo.AccountGroup
   SET ParentGroupId = 8
 WHERE AGId = 79
   AND Code = 'LNA'
   AND ParentGroupId IS NULL;

PRINT 'LOANS AND ADVANCES (AGId 79) reparented under CURRENT LIABILITIES (AGId 8) for the Trial Balance tree.';
