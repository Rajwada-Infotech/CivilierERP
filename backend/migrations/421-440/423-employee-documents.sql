-- Migration 423: Employee document attachments (Aadhaar / PAN / Resume /
-- Appointment Letter / Joining Documents / Bank Proof / Certificates /
-- Experience Letter) — mirrors dbo.LoanDocumentAttachments (migration 288)
-- and dbo.GRNAttachments: binary-in-DB, not filesystem, same as every
-- other document-attachment table in this app.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'EmployeeDocuments' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.EmployeeDocuments (
    AttachmentId  INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeId    INT NOT NULL,
    DocType       NVARCHAR(30)   NOT NULL DEFAULT 'Other',
    FileName      NVARCHAR(255)  NOT NULL,
    MimeType      NVARCHAR(100)  NOT NULL,
    FileSize      INT            NOT NULL,
    FileData      VARBINARY(MAX) NOT NULL,
    UploadedBy    NVARCHAR(150)  NULL,
    UploadedAt    DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_EmployeeDocuments_Employee FOREIGN KEY (EmployeeId) REFERENCES dbo.EmployeeMaster(EmployeeId) ON DELETE CASCADE
  );
  CREATE INDEX IX_EmployeeDocuments_EmployeeId ON dbo.EmployeeDocuments(EmployeeId);
END
GO
