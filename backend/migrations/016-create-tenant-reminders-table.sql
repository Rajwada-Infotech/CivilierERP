-- Migration 016: Create TenantReminders table
-- Safe idempotent version

IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='TenantReminders' AND xtype='U')
CREATE TABLE dbo.TenantReminders (
  ReminderId    INT IDENTITY(1,1) PRIMARY KEY,
  Title         NVARCHAR(255) NOT NULL,
  Message       NVARCHAR(MAX) NULL,
  Module        NVARCHAR(100) NULL,   -- e.g. 'PO', 'WO', 'CHQ', 'TDS', 'GRN'
  RefId         INT NULL,             -- ID of the related record
  DueDate       DATE NULL,
  SentAt        DATETIME2 NULL,
  IsSent        BIT NOT NULL DEFAULT 0,
  CreatedBy     NVARCHAR(100) NULL,
  CreatedAt     DATETIME2 DEFAULT SYSDATETIME()
);

PRINT '✅ TenantReminders table created/verified successfully';

