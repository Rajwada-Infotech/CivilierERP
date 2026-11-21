-- Migration 287: Loan repayment tracking (EMI / lump sum), auto-closure,
-- late fees, and NOC attachments (Bank Loan + Customer Loan only — see
-- routes/loanSanction.js POST /:id/pay for the type guard).

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'LoanPayment' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.LoanPayment (
    PaymentId                 INT IDENTITY(1,1) PRIMARY KEY,
    LoanId                    INT NOT NULL,
    PaymentRef                NVARCHAR(100) NOT NULL,
    PaymentDate               DATE NOT NULL,
    PaymentType                NVARCHAR(20) NOT NULL, -- 'EMI' | 'LumpSum'
    PrincipalInterestAmount   DECIMAL(18,2) NOT NULL, -- applied toward the loan itself
    LateFee                   DECIMAL(18,2) NOT NULL DEFAULT 0,
    TotalAmount                DECIMAL(18,2) NOT NULL, -- PrincipalInterestAmount + LateFee
    ExcessCredited            DECIMAL(18,2) NOT NULL DEFAULT 0, -- overpayment sent to lender's On A/C
    ClosedLoan                BIT NOT NULL DEFAULT 0,
    Notes                     NVARCHAR(500) NULL,
    CreatedBy                 NVARCHAR(150) NULL,
    CreatedAt                 DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_LoanPayment_Loan FOREIGN KEY (LoanId) REFERENCES dbo.LoanSanction(LoanId)
  );
  CREATE INDEX IX_LoanPayment_LoanId ON dbo.LoanPayment(LoanId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanEMISchedule') AND name = 'PaymentId')
  ALTER TABLE dbo.LoanEMISchedule ADD PaymentId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_LoanEMISchedule_Payment')
  ALTER TABLE dbo.LoanEMISchedule ADD CONSTRAINT FK_LoanEMISchedule_Payment FOREIGN KEY (PaymentId) REFERENCES dbo.LoanPayment(PaymentId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'ClosedAt')
  ALTER TABLE dbo.LoanSanction ADD ClosedAt DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'ClosurePaymentId')
  ALTER TABLE dbo.LoanSanction ADD ClosurePaymentId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'NOCAttachmentId')
  ALTER TABLE dbo.LoanSanction ADD NOCAttachmentId INT NULL;
GO

-- Mirrors dbo.GRNAttachments (migration 146) — one row per file, binary
-- stored directly in the DB, own streaming endpoint.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'LoanNOCAttachments' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.LoanNOCAttachments (
    AttachmentId  INT IDENTITY(1,1) PRIMARY KEY,
    LoanId        INT NOT NULL,
    FileName      NVARCHAR(255)  NOT NULL,
    MimeType      NVARCHAR(100)  NOT NULL,
    FileSize      INT            NOT NULL,
    FileData      VARBINARY(MAX) NOT NULL,
    UploadedBy    NVARCHAR(150)  NULL,
    UploadedAt    DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_LoanNOCAttachments_Loan FOREIGN KEY (LoanId) REFERENCES dbo.LoanSanction(LoanId) ON DELETE CASCADE
  );
  CREATE INDEX IX_LoanNOCAttachments_LoanId ON dbo.LoanNOCAttachments(LoanId);
END
GO
