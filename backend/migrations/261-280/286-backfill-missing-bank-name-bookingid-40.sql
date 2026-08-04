-- Finds every booking whose CrmCustomerBankDetail row exists but is missing
-- one or more of the fields REQUIRED_CUSTOMER_DETAIL_FIELDS
-- (backend/services/crmWorkflowGuards.js) requires before agreement prep.
--
-- "Has some data but not all of it" is the interesting case here (a totally
-- empty row just means KYC hasn't been started yet, which is normal and not
-- a bug). So this filters to rows where AccountNo is present (i.e. someone
-- clearly started filling this in) but at least one other required field
-- isn't — the same shape as the BKG-2026-00001 / BookingId 40 bug.

SELECT
  b.Id AS BookingId,
  b.BookingNo,
  a.ApplicantName,
  d.BookingStageVerifiedAt,
  CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(d.BankName, ''))), '')           IS NULL THEN 'BankName, '           ELSE '' END +
  CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(d.AccountNo, ''))), '')          IS NULL THEN 'AccountNo, '          ELSE '' END +
  CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(d.IfscCode, ''))), '')           IS NULL THEN 'IfscCode, '           ELSE '' END +
  CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(d.AccountHolderName, ''))), '')  IS NULL THEN 'AccountHolderName, '  ELSE '' END +
  CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(d.NomineeName, ''))), '')        IS NULL THEN 'NomineeName, '        ELSE '' END +
  CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(d.NomineeRelation, ''))), '')    IS NULL THEN 'NomineeRelation, '    ELSE '' END +
  CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(d.PanNo, ''))), '')              IS NULL THEN 'PanNo, '              ELSE '' END +
  CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(d.AadhaarNo, ''))), '')          IS NULL THEN 'AadhaarNo, '          ELSE '' END +
  CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(d.Occupation, ''))), '')         IS NULL THEN 'Occupation, '         ELSE '' END
    AS MissingFields
FROM dbo.CrmCustomerBankDetail d
JOIN dbo.CrmBooking b ON b.Id = d.BookingId
JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
WHERE b.IsActive = 1
  AND NULLIF(LTRIM(RTRIM(ISNULL(d.AccountNo, ''))), '') IS NOT NULL  -- data entry was clearly started
  AND (
    NULLIF(LTRIM(RTRIM(ISNULL(d.BankName, ''))), '')          IS NULL OR
    NULLIF(LTRIM(RTRIM(ISNULL(d.IfscCode, ''))), '')          IS NULL OR
    NULLIF(LTRIM(RTRIM(ISNULL(d.AccountHolderName, ''))), '') IS NULL OR
    NULLIF(LTRIM(RTRIM(ISNULL(d.NomineeName, ''))), '')       IS NULL OR
    NULLIF(LTRIM(RTRIM(ISNULL(d.NomineeRelation, ''))), '')   IS NULL OR
    NULLIF(LTRIM(RTRIM(ISNULL(d.PanNo, ''))), '')             IS NULL OR
    NULLIF(LTRIM(RTRIM(ISNULL(d.AadhaarNo, ''))), '')         IS NULL OR
    NULLIF(LTRIM(RTRIM(ISNULL(d.Occupation, ''))), '')        IS NULL
  )
ORDER BY b.CreatedAt DESC;