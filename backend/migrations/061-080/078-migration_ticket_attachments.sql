-- ============================================================
-- Run this in SSMS once to create the ticket_attachments table
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ticket_attachments'
)
BEGIN
  CREATE TABLE dbo.ticket_attachments (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    ticket_id     INT NOT NULL,
    comment_id    INT NULL,               -- NULL = ticket-level attachment, set = comment attachment
    filename      NVARCHAR(255) NOT NULL, -- original filename e.g. "photo.jpg"
    mime_type     NVARCHAR(100) NOT NULL, -- e.g. "image/jpeg"
    file_size     INT NOT NULL,           -- bytes
    file_data     VARBINARY(MAX) NOT NULL,-- binary content stored in DB
    uploaded_by   INT NOT NULL,
    uploaded_at   DATETIME2 DEFAULT SYSUTCDATETIME(),

    CONSTRAINT FK_TicketAttachments_Ticket
      FOREIGN KEY (ticket_id) REFERENCES dbo.tickets(id) ON DELETE CASCADE
  );

  CREATE INDEX IX_TicketAttachments_TicketId  ON dbo.ticket_attachments(ticket_id);
  CREATE INDEX IX_TicketAttachments_CommentId ON dbo.ticket_attachments(comment_id);

  PRINT 'ticket_attachments table created successfully.';
END
ELSE
BEGIN
  PRINT 'ticket_attachments table already exists — skipped.';
END
