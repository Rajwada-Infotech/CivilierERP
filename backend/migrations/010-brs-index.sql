-- Add positive amount constraint if not exists
IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'chk_amount_positive')
BEGIN
  ALTER TABLE BankReconciliation
  ADD CONSTRAINT chk_amount_positive CHECK (Amount >= 0);
END

-- Create performance index
CREATE NONCLUSTERED INDEX idx_brs_bank_date 
ON BankReconciliation (BankID, BankDate DESC) 
INCLUDE (BRSID, Amount, IsMatched);
