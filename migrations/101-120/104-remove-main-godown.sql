-- Migration 104: Remove the seeded Main Godown
-- The Main Godown is no longer used; project godowns serve as the primary
-- storage per project. This soft-deletes it and removes the backend guard.

-- Step 1: Soft-delete the Main Godown row
UPDATE dbo.Godowns
SET IsDeleted = 1,
    UpdatedAt = SYSDATETIME()
WHERE IsMain = 1
  AND IsDeleted = 0;

-- Step 2: Reassign any StockLedger rows that point to the Main Godown
-- to NULL so they don't orphan (optional — only if GodownID column exists)
-- If you want to preserve history, skip this block.
IF COL_LENGTH('dbo.StockLedger', 'GodownID') IS NOT NULL
BEGIN
  UPDATE dbo.StockLedger
  SET GodownID = NULL
  WHERE GodownID IN (
    SELECT GodownID FROM dbo.Godowns WHERE IsMain = 1
  );
END
