IF OBJECT_ID('dbo.tickets', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.tickets (
    id INT IDENTITY(1,1) PRIMARY KEY,
    subject NVARCHAR(500) NOT NULL,
    priority NVARCHAR(50) NOT NULL DEFAULT 'Medium',
    issue_details NVARCHAR(MAX) NOT NULL,
    customer_name NVARCHAR(255) NOT NULL,
    customer_phone NVARCHAR(50) NULL,
    company_id INT NULL,
    project_id INT NULL,
    attachment_path NVARCHAR(MAX) NULL,
    status NVARCHAR(50) NOT NULL DEFAULT 'Pending',
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;

IF COL_LENGTH('dbo.tickets', 'assigned_to') IS NULL
  ALTER TABLE dbo.tickets ADD assigned_to NVARCHAR(255) NULL;
IF COL_LENGTH('dbo.tickets', 'assigned_to_id') IS NULL
  ALTER TABLE dbo.tickets ADD assigned_to_id INT NULL;
IF COL_LENGTH('dbo.tickets', 'resolved_by') IS NULL
  ALTER TABLE dbo.tickets ADD resolved_by NVARCHAR(255) NULL;
IF COL_LENGTH('dbo.tickets', 'resolved_by_id') IS NULL
  ALTER TABLE dbo.tickets ADD resolved_by_id INT NULL;
IF COL_LENGTH('dbo.tickets', 'resolution_note') IS NULL
  ALTER TABLE dbo.tickets ADD resolution_note NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.tickets', 'created_by') IS NULL
  ALTER TABLE dbo.tickets ADD created_by NVARCHAR(255) NULL;
IF COL_LENGTH('dbo.tickets', 'created_by_id') IS NULL
  ALTER TABLE dbo.tickets ADD created_by_id INT NULL;
IF COL_LENGTH('dbo.tickets', 'updated_at') IS NULL
  ALTER TABLE dbo.tickets ADD updated_at DATETIME2 NULL;
IF COL_LENGTH('dbo.tickets', 'resolved_at') IS NULL
  ALTER TABLE dbo.tickets ADD resolved_at DATETIME2 NULL;
IF COL_LENGTH('dbo.tickets', 'closed_at') IS NULL
  ALTER TABLE dbo.tickets ADD closed_at DATETIME2 NULL;

UPDATE dbo.tickets
SET updated_at = ISNULL(updated_at, created_at)
WHERE updated_at IS NULL;

IF OBJECT_ID('dbo.ticket_comments', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ticket_comments (
    id INT IDENTITY(1,1) PRIMARY KEY,
    ticket_id INT NOT NULL,
    comment NVARCHAR(MAX) NOT NULL,
    author_name NVARCHAR(255) NOT NULL,
    author_id INT NULL,
    author_role NVARCHAR(50) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_ticket_comments_tickets
      FOREIGN KEY (ticket_id) REFERENCES dbo.tickets(id) ON DELETE CASCADE
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tickets_status' AND object_id = OBJECT_ID('dbo.tickets'))
  CREATE INDEX IX_tickets_status ON dbo.tickets(status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tickets_priority' AND object_id = OBJECT_ID('dbo.tickets'))
  CREATE INDEX IX_tickets_priority ON dbo.tickets(priority);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tickets_assigned_to_id' AND object_id = OBJECT_ID('dbo.tickets'))
  CREATE INDEX IX_tickets_assigned_to_id ON dbo.tickets(assigned_to_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tickets_created_by_id' AND object_id = OBJECT_ID('dbo.tickets'))
  CREATE INDEX IX_tickets_created_by_id ON dbo.tickets(created_by_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ticket_comments_ticket' AND object_id = OBJECT_ID('dbo.ticket_comments'))
  CREATE INDEX IX_ticket_comments_ticket ON dbo.ticket_comments(ticket_id, created_at);
