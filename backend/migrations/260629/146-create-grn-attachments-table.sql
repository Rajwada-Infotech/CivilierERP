-- Migration 146: Store GRN attachments as binary in the database.
-- Mirrors dbo.VehicleInOutAttachments (migration 119) — one row per file,
-- nullable GRNID until the parent GRN is saved, FK cascade-delete.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'GRNAttachments'
)
BEGIN
  CREATE TABLE dbo.GRNAttachments (
    AttachmentId  INT             IDENTITY(1,1) PRIMARY KEY,
    GRNID         INT             NULL,
    FileName      NVARCHAR(255)   NOT NULL,
    MimeType      NVARCHAR(100)   NOT NULL,
    FileSize      INT             NOT NULL,
    FileData      VARBINARY(MAX)  NOT NULL,
    UploadedBy    NVARCHAR(150)   NULL,
    UploadedAt    DATETIME2       NOT NULL CONSTRAINT DF_GRNAtt_UploadedAt DEFAULT SYSDATETIME(),

    CONSTRAINT FK_GRNAttachments_Parent
      FOREIGN KEY (GRNID) REFERENCES dbo.GoodsReceiptNotes(GRNID)
      ON DELETE CASCADE
  );

  CREATE INDEX IX_GRNAttachments_GRNID
    ON dbo.GRNAttachments(GRNID);

  PRINT 'Created dbo.GRNAttachments';
END
ELSE
  PRINT 'dbo.GRNAttachments already exists — skipped';
GO
GO
