-- Migration 280: dbo.AccountHeadMaster (Bank Master) had a unique index on
-- LIFSCCode alone — meaning only ONE bank account could ever be registered
-- per branch, system-wide. Two different companies with their own accounts
-- at the same branch (same IFSC, different account numbers) couldn't both
-- be saved. The real-world unique identity of a bank account is IFSC +
-- Account Number together, not IFSC alone — switching to that composite.

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UIX_AccountHeadMaster_IFSC' AND object_id = OBJECT_ID('dbo.AccountHeadMaster'))
BEGIN
  DROP INDEX UIX_AccountHeadMaster_IFSC ON dbo.AccountHeadMaster;
END
GO

-- Filtered (excludes NULLs, same as before) so non-bank account heads
-- (LIFSCCode/LAccountNo both NULL) are unaffected.
CREATE UNIQUE NONCLUSTERED INDEX UIX_AccountHeadMaster_IFSC_AccountNo
  ON dbo.AccountHeadMaster (LIFSCCode, LAccountNo)
  WHERE LIFSCCode IS NOT NULL AND LAccountNo IS NOT NULL;
GO
