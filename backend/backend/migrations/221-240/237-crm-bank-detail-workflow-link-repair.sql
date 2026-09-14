-- Migration 237: CRM bank/KYC workflow key repair
-- A single CrmCustomerBankDetail row belongs to the Application workflow first
-- and the Booking workflow once conversion happens. This repairs old rows
-- that were only keyed by one side, and merges duplicate Application/Booking
-- rows for the same workflow before re-linking both ids.

IF OBJECT_ID('dbo.CrmCustomerBankDetail', 'U') IS NOT NULL
BEGIN
  ;WITH DuplicatePairs AS (
    SELECT
      keepRow.Id AS KeepId,
      dropRow.Id AS DropId
    FROM dbo.CrmCustomerBankDetail keepRow
    JOIN dbo.CrmBooking b ON b.Id = keepRow.BookingId
    JOIN dbo.CrmCustomerBankDetail dropRow
      ON dropRow.ApplicationId = b.ApplicationId
     AND dropRow.Id <> keepRow.Id
    WHERE keepRow.BookingId IS NOT NULL
  )
  UPDATE keepRow SET
    BankName = COALESCE(keepRow.BankName, dropRow.BankName),
    BranchName = COALESCE(keepRow.BranchName, dropRow.BranchName),
    AccountNo = COALESCE(keepRow.AccountNo, dropRow.AccountNo),
    IfscCode = COALESCE(keepRow.IfscCode, dropRow.IfscCode),
    AccountHolderName = COALESCE(keepRow.AccountHolderName, dropRow.AccountHolderName),
    NomineeName = COALESCE(keepRow.NomineeName, dropRow.NomineeName),
    NomineeRelation = COALESCE(keepRow.NomineeRelation, dropRow.NomineeRelation),
    NomineeDob = COALESCE(keepRow.NomineeDob, dropRow.NomineeDob),
    NomineeContact = COALESCE(keepRow.NomineeContact, dropRow.NomineeContact),
    NomineeAddress = COALESCE(keepRow.NomineeAddress, dropRow.NomineeAddress),
    PanNo = COALESCE(keepRow.PanNo, dropRow.PanNo),
    AadhaarNo = COALESCE(keepRow.AadhaarNo, dropRow.AadhaarNo),
    Occupation = COALESCE(keepRow.Occupation, dropRow.Occupation),
    AnnualIncome = COALESCE(keepRow.AnnualIncome, dropRow.AnnualIncome),
    ChequeNo = COALESCE(keepRow.ChequeNo, dropRow.ChequeNo),
    ChequeDate = COALESCE(keepRow.ChequeDate, dropRow.ChequeDate),
    TransactionRef = COALESCE(keepRow.TransactionRef, dropRow.TransactionRef),
    Notes = COALESCE(keepRow.Notes, dropRow.Notes),
    UpdatedAt = SYSDATETIME()
  FROM dbo.CrmCustomerBankDetail keepRow
  JOIN DuplicatePairs p ON p.KeepId = keepRow.Id
  JOIN dbo.CrmCustomerBankDetail dropRow ON dropRow.Id = p.DropId;

  ;WITH DuplicatePairs AS (
    SELECT dropRow.Id AS DropId
    FROM dbo.CrmCustomerBankDetail keepRow
    JOIN dbo.CrmBooking b ON b.Id = keepRow.BookingId
    JOIN dbo.CrmCustomerBankDetail dropRow
      ON dropRow.ApplicationId = b.ApplicationId
     AND dropRow.Id <> keepRow.Id
    WHERE keepRow.BookingId IS NOT NULL
  )
  DELETE d
  FROM dbo.CrmCustomerBankDetail d
  JOIN DuplicatePairs p ON p.DropId = d.Id;

  UPDATE d
  SET d.ApplicationId = b.ApplicationId,
      d.UpdatedAt = COALESCE(d.UpdatedAt, SYSDATETIME())
  FROM dbo.CrmCustomerBankDetail d
  JOIN dbo.CrmBooking b ON b.Id = d.BookingId
  WHERE d.BookingId IS NOT NULL
    AND d.ApplicationId IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM dbo.CrmCustomerBankDetail x
      WHERE x.ApplicationId = b.ApplicationId AND x.Id <> d.Id
    );

  UPDATE d
  SET d.BookingId = b.Id,
      d.UpdatedAt = COALESCE(d.UpdatedAt, SYSDATETIME())
  FROM dbo.CrmCustomerBankDetail d
  JOIN dbo.CrmBooking b ON b.ApplicationId = d.ApplicationId AND b.IsActive = 1
  WHERE d.ApplicationId IS NOT NULL
    AND d.BookingId IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM dbo.CrmCustomerBankDetail x
      WHERE x.BookingId = b.Id AND x.Id <> d.Id
    );

  UPDATE d
  SET d.PanNo = COALESCE(NULLIF(LTRIM(RTRIM(d.PanNo)), ''), c.PanNo),
      d.AccountHolderName = COALESCE(NULLIF(LTRIM(RTRIM(d.AccountHolderName)), ''), c.CustomerName),
      d.UpdatedAt = COALESCE(d.UpdatedAt, SYSDATETIME())
  FROM dbo.CrmCustomerBankDetail d
  JOIN dbo.CrmApplication a ON a.Id = d.ApplicationId
  JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
  WHERE (NULLIF(LTRIM(RTRIM(d.PanNo)), '') IS NULL AND NULLIF(LTRIM(RTRIM(c.PanNo)), '') IS NOT NULL)
     OR (NULLIF(LTRIM(RTRIM(d.AccountHolderName)), '') IS NULL AND NULLIF(LTRIM(RTRIM(c.CustomerName)), '') IS NOT NULL);

  PRINT 'Repaired CRM bank/KYC ApplicationId/BookingId workflow links';
END
GO
