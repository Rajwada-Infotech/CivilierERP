-- Migration 103: Fix CHK_Account_Type constraint to include all frontend account types
-- The existing constraint was missing 'Cash Credit' and 'Overdraft (OD)'

IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CHK_Account_Type'
      AND parent_object_id = OBJECT_ID('dbo.AccountHeadMaster')
)
BEGIN
    ALTER TABLE dbo.AccountHeadMaster DROP CONSTRAINT CHK_Account_Type;
END
GO

ALTER TABLE dbo.AccountHeadMaster
    ADD CONSTRAINT CHK_Account_Type
    CHECK (
        LAccountType IS NULL OR
        LAccountType IN ('Current', 'Savings', 'Overdraft (OD)', 'Cash Credit')
    );
GO
