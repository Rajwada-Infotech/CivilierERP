-- Migration 181: Add Parties JSON column to dbo.Contract
-- Stores an array of { type, id, name } party pills linked to a contract.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Contract')
    AND name = 'Parties'
)
BEGIN
  ALTER TABLE dbo.Contract
    ADD Parties NVARCHAR(MAX) NULL;
END
