-- NewPayment supports Cash and digital payment modes where no bank account is
-- selected. Older databases have PBankID as NOT NULL, which makes those saves
-- fail before the application can store the payment.

IF COL_LENGTH('dbo.NewPayment', 'PBankID') IS NOT NULL
BEGIN
  UPDATE dbo.NewPayment
  SET PBankID = NULL
  WHERE PBankID = 0;

  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.NewPayment')
      AND name = 'PBankID'
      AND is_nullable = 0
  )
  BEGIN
    ALTER TABLE dbo.NewPayment ALTER COLUMN PBankID INT NULL;
  END
END;
GO
