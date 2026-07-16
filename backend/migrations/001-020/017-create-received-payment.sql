IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'ReceivedPayment' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.ReceivedPayment (
    RPPaymentID INT IDENTITY(1,1) PRIMARY KEY,
    RPCompanyName NVARCHAR(255) NULL,
    RPReceivedFrom NVARCHAR(255) NOT NULL DEFAULT '',
    RPProjectName NVARCHAR(255) NOT NULL DEFAULT '',
    RPDocDate DATE NULL,
    RPMode NVARCHAR(50) NOT NULL DEFAULT 'Cash',
    RPAmount DECIMAL(18,2) NOT NULL DEFAULT 0,
    RPBankName NVARCHAR(255) NULL,
    RPTransactionId NVARCHAR(255) NULL,
    RPCheckNumber NVARCHAR(100) NULL,
    RPRemarks NVARCHAR(MAX) NULL,
    RPIsEmi BIT NOT NULL DEFAULT 0,
    RPEmiTotal DECIMAL(18,2) NULL,
    RPEmiMonths INT NULL,
    RPEmiStartDate NVARCHAR(30) NULL,
    RPEmiSchedule NVARCHAR(MAX) NULL,
    RPEmiPaying NVARCHAR(MAX) NULL,
    RPStatus NVARCHAR(20) NOT NULL DEFAULT 'Draft',
    RPCreatedBy NVARCHAR(100) NULL,
    RPCreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    RPUpdatedBy NVARCHAR(150) NULL,
    RPUpdatedAt DATETIME2 NULL,
    RPApprovedBy NVARCHAR(150) NULL,
    RPApprovedAt DATETIME2 NULL,
    RPRejectedBy NVARCHAR(150) NULL,
    RPRejectedAt DATETIME2 NULL,
    RPRejectionNote NVARCHAR(500) NULL
  );

  CREATE INDEX IX_ReceivedPayment_Status ON dbo.ReceivedPayment(RPStatus);
  CREATE INDEX IX_ReceivedPayment_DocDate ON dbo.ReceivedPayment(RPDocDate);
  CREATE INDEX IX_ReceivedPayment_CreatedAt ON dbo.ReceivedPayment(RPCreatedAt DESC);
END
