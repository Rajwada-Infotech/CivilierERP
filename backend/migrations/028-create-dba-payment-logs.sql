IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'DbaPaymentLogs' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.DbaPaymentLogs (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    txn_id NVARCHAR(200) NOT NULL,
    tenant_id NVARCHAR(100) NULL,
    tenant_name NVARCHAR(255) NULL,
    amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    method NVARCHAR(50) NULL,
    upi_id NVARCHAR(200) NULL,
    bank_ref NVARCHAR(200) NULL,
    paid_by NVARCHAR(200) NULL,
    paid_on DATE NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'pending',
    purpose NVARCHAR(255) NULL,
    [plan] NVARCHAR(100) NULL,
    renewal_period NVARCHAR(100) NULL,
    remarks NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    updated_at DATETIME2 NULL
  );
  CREATE INDEX IX_DbaPaymentLogs_Status_CreatedAt
    ON dbo.DbaPaymentLogs(status, created_at DESC);
END