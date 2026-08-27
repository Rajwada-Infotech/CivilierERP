-- Welcome Call — Customer Bank Preference
-- Records which bank(s) a customer prefers for their home loan,
-- captured during the welcome call. This is NOT the finalised/sanctioned
-- loan (that lives in dbo.CrmLoanDetail / Home Loan Tracking); it is
-- an early-stage preference so the sales/banking team knows which banks
-- to approach first. Multiple rows per booking are expected.
IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.CrmWelcomeCallBankPreference')
)
BEGIN
  CREATE TABLE dbo.CrmWelcomeCallBankPreference (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    BookingId  INT          NOT NULL
                 REFERENCES dbo.CrmBooking(Id) ON DELETE CASCADE,
    BankName   NVARCHAR(200) NOT NULL,
    Remarks    NVARCHAR(500) NULL,
    CreatedBy  INT          NULL REFERENCES dbo.Users(id),
    CreatedAt  DATETIME2(3) NOT NULL DEFAULT SYSDATETIME()
  );

  CREATE INDEX IX_CrmWelcomeCallBankPreference_BookingId
    ON dbo.CrmWelcomeCallBankPreference (BookingId);
END
