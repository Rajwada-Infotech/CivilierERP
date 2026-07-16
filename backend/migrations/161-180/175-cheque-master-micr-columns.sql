-- Add MICR full-string columns to ChequeMaster
-- ChequeStartNumber / ChequeEndNumber keep the 6-digit seq for the computed TotalCheques column.
-- ChequeStartMICR / ChequeEndMICR store the full 15-char MICR code (seq + city + bank + branch).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.ChequeMaster') AND name = 'ChequeStartMICR'
)
  ALTER TABLE dbo.ChequeMaster ADD ChequeStartMICR NVARCHAR(15) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.ChequeMaster') AND name = 'ChequeEndMICR'
)
  ALTER TABLE dbo.ChequeMaster ADD ChequeEndMICR NVARCHAR(15) NULL;

GO

-- Back-fill existing rows: take up to 6 digits from the stored number + 9 zeros for city/bank/branch
UPDATE dbo.ChequeMaster
SET
  ChequeStartMICR = RIGHT('000000' + LEFT(CAST(ChequeStartNumber AS NVARCHAR(20)), 6), 6) + '000000000',
  ChequeEndMICR   = RIGHT('000000' + LEFT(CAST(ChequeEndNumber   AS NVARCHAR(20)), 6), 6) + '000000000'
WHERE ChequeStartMICR IS NULL AND ChequeStartNumber IS NOT NULL;
