-- Migration 173: Return Reason Master (for BRS cheque bounce reason dropdown)

IF OBJECT_ID('dbo.ReturnReasonMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReturnReasonMaster (
    ReasonId      INT IDENTITY(1,1) PRIMARY KEY,
    ReasonName    NVARCHAR(200)  NOT NULL,
    ReasonDesc    NVARCHAR(MAX)  NULL,
    IsActive      BIT            NOT NULL DEFAULT 1,
    CreatedBy     NVARCHAR(200)  NULL,
    UpdatedBy     NVARCHAR(200)  NULL,
    CreatedAt     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt     DATETIME2      NOT NULL DEFAULT SYSDATETIME()
  );

  -- Seed the standard cheque return reasons
  INSERT INTO dbo.ReturnReasonMaster (ReasonName, ReasonDesc, IsActive, CreatedBy)
  VALUES
    ('Insufficient Funds',               'Drawer''s account does not have sufficient balance', 1, 'system'),
    ('Payment Stopped by Drawer',        'Drawer issued a stop payment instruction to their bank', 1, 'system'),
    ('Account Closed',                   'Drawer''s bank account has been closed', 1, 'system'),
    ('Account Frozen / Under Lien',      'Drawer''s account is frozen or under a lien order', 1, 'system'),
    ('Signature Mismatch',               'Signature on cheque does not match bank records', 1, 'system'),
    ('Cheque Expired / Stale',           'Cheque is older than three months (stale-dated)', 1, 'system'),
    ('Amount in Words and Figures Differ','Written amount does not match the numeric amount', 1, 'system'),
    ('Cheque Mutilated / Damaged',       'Physical cheque is torn, mutilated or damaged', 1, 'system'),
    ('Technical / Clearing Error',       'Returned due to a bank or clearing-house technical error', 1, 'system'),
    ('Other',                            'Any other reason not covered above', 1, 'system');

  PRINT 'Created dbo.ReturnReasonMaster and seeded default reasons.';
END
ELSE
  PRINT 'dbo.ReturnReasonMaster already exists — skipped.';

-- Page definition
IF OBJECT_ID('dbo.PageDefinitions', 'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'return-reason-master')
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, CreatedBy)
    VALUES ('return-reason-master', 'Return Reason Master', 'Finance', 'Setup Masters', 'view,create,edit,delete', 90, 'system');
END
