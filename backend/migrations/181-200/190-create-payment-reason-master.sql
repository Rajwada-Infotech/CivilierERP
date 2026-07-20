-- Migration 190: Payment Reason Master (Finance setup)

IF OBJECT_ID('dbo.PaymentReasonMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PaymentReasonMaster (
    ReasonId      INT IDENTITY(1,1) PRIMARY KEY,
    ReasonName    NVARCHAR(200)  NOT NULL,
    ReasonDesc    NVARCHAR(MAX)  NULL,
    IsActive      BIT            NOT NULL DEFAULT 1,
    CreatedBy     NVARCHAR(200)  NULL,
    UpdatedBy     NVARCHAR(200)  NULL,
    CreatedAt     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt     DATETIME2      NOT NULL DEFAULT SYSDATETIME()
  );

  PRINT 'Created dbo.PaymentReasonMaster';
END
ELSE
  PRINT 'dbo.PaymentReasonMaster already exists — skipped.';

-- Page definition
IF OBJECT_ID('dbo.PageDefinitions', 'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'payment-reason-master')
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, CreatedBy)
    VALUES ('payment-reason-master', 'Payment Reason Master', 'Finance', 'Setup Masters', 'view,create,edit,delete', 100, 'system');
END
