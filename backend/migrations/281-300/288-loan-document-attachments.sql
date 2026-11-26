-- Migration 288: Loan document attachments (agreement / sanction letter /
-- other supporting docs uploaded against the Loan Doc No. field) — distinct
-- from LoanNOCAttachments (migration 287), which is specifically the
-- closure NOC. Mirrors dbo.GRNAttachments / dbo.LoanNOCAttachments.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'LoanDocumentAttachments' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.LoanDocumentAttachments (
    AttachmentId  INT IDENTITY(1,1) PRIMARY KEY,
    LoanId        INT NOT NULL,
    DocType       NVARCHAR(30)   NOT NULL DEFAULT 'Agreement',
    FileName      NVARCHAR(255)  NOT NULL,
    MimeType      NVARCHAR(100)  NOT NULL,
    FileSize      INT            NOT NULL,
    FileData      VARBINARY(MAX) NOT NULL,
    UploadedBy    NVARCHAR(150)  NULL,
    UploadedAt    DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_LoanDocumentAttachments_Loan FOREIGN KEY (LoanId) REFERENCES dbo.LoanSanction(LoanId) ON DELETE CASCADE
  );
  CREATE INDEX IX_LoanDocumentAttachments_LoanId ON dbo.LoanDocumentAttachments(LoanId);
END
GO
