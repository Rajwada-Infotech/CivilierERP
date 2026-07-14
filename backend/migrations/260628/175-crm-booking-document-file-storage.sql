-- Real file storage for CrmBookingDocument (multi-file upload + preview),
-- alongside the existing DocumentUrl (kept for pasting an external link).
ALTER TABLE dbo.CrmBookingDocument ADD
  FilePath NVARCHAR(500) NULL,
  FileSize BIGINT NULL,
  MimeType NVARCHAR(150) NULL;
GO
