-- Migration 119: Store Vehicle In/Out attachments as binary IN THE DATABASE
-- instead of on local disk (backend/uploads/vehicle-in-out/).
--
-- Why: local-disk storage ties an attachment to whichever app server handled
-- the upload request — it breaks across multi-instance deployments, restarts
-- on ephemeral disks, and container redeploys. Storing the bytes in SQL
-- Server (same pattern already used for dbo.ticket_attachments) means any
-- app instance can serve any attachment, and attachments are included in
-- normal DB backups automatically.
--
-- This creates a new child table — one row per file — rather than reusing
-- the existing VehicleInOut.AttachmentPath column, since a VARBINARY(MAX)
-- column holding *multiple* files per row isn't workable; a child table with
-- one row per attachment is the correct shape (mirrors dbo.ticket_attachments).
--
-- AttachmentPath on dbo.VehicleInOut is left in place but considered
-- deprecated after this migration — new uploads go through this table only;
-- old rows with values in AttachmentPath still display their links (handled
-- in application code, not here) until re-uploaded.
--
-- Safe to re-run: guarded by IF NOT EXISTS.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VehicleInOutAttachments'
)
BEGIN
  CREATE TABLE dbo.VehicleInOutAttachments (
    AttachmentId     INT             IDENTITY(1,1) PRIMARY KEY,
    VehicleInOutID    INT             NULL,  -- NULL until the parent record is saved (see note below)
    FileName         NVARCHAR(255)   NOT NULL,
    MimeType         NVARCHAR(100)   NOT NULL,
    FileSize         INT             NOT NULL,   -- bytes
    FileData         VARBINARY(MAX)  NOT NULL,   -- the actual file content
    UploadedBy       NVARCHAR(150)   NULL,
    UploadedAt       DATETIME2       NOT NULL CONSTRAINT DF_VIOAtt_UploadedAt DEFAULT SYSDATETIME(),

    CONSTRAINT FK_VehicleInOutAttachments_Parent
      FOREIGN KEY (VehicleInOutID) REFERENCES dbo.VehicleInOut(VehicleInOutID)
      ON DELETE CASCADE
  );

  CREATE INDEX IX_VehicleInOutAttachments_VehicleInOutID
    ON dbo.VehicleInOutAttachments(VehicleInOutID);

  PRINT 'Created dbo.VehicleInOutAttachments';
END
ELSE
  PRINT 'dbo.VehicleInOutAttachments already exists — skipped';
GO

-- Note on VehicleInOutID being nullable: the frontend uploads camera
-- captures / files as the user fills out the "New Entry" form, *before* the
-- parent VehicleInOut row exists yet (same flow as ticket attachments,
-- which upload against a ticketId created moments earlier). The app links
-- each attachment's VehicleInOutID once the form is actually submitted —
-- see backend/routes/vehicleInOut.js. Orphaned attachments (form abandoned
-- without submitting) are cleaned up by the optional housekeeping query
-- below; safe to run periodically (e.g. a scheduled job), not part of this
-- migration's automatic execution.
--
--   DELETE FROM dbo.VehicleInOutAttachments
--   WHERE VehicleInOutID IS NULL
--     AND UploadedAt < DATEADD(HOUR, -24, SYSDATETIME());

-- Verify
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VehicleInOutAttachments'
ORDER BY ORDINAL_POSITION;
