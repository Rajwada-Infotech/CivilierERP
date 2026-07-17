-- migration: create_approval_workflows_v2.sql
-- Run once. Drops the old table if it exists with the old schema (no levels JSON column).
-- Safe to re-run: uses IF NOT EXISTS checks.

-- Create table if it doesn't exist
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ApprovalWorkflows'
)
BEGIN
  CREATE TABLE dbo.ApprovalWorkflows (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    name       NVARCHAR(255)    NOT NULL,
    type       NVARCHAR(50)     NOT NULL DEFAULT 'sequential',  -- sequential | any | parallel
    modules    NVARCHAR(MAX)    NOT NULL DEFAULT '[]',          -- JSON string[]
    levels     NVARCHAR(MAX)    NOT NULL DEFAULT '[]',          -- JSON ApprovalLevel[]
    active     BIT              NOT NULL DEFAULT 1,
    created_at DATETIME         NOT NULL DEFAULT GETDATE()
  );
  PRINT 'Created dbo.ApprovalWorkflows';
END
ELSE
BEGIN
  -- Add missing columns if upgrading from old schema
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'ApprovalWorkflows' AND COLUMN_NAME = 'type'
  )
    ALTER TABLE dbo.ApprovalWorkflows ADD type NVARCHAR(50) NOT NULL DEFAULT 'sequential';

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'ApprovalWorkflows' AND COLUMN_NAME = 'modules'
  )
    ALTER TABLE dbo.ApprovalWorkflows ADD modules NVARCHAR(MAX) NOT NULL DEFAULT '[]';

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'ApprovalWorkflows' AND COLUMN_NAME = 'levels'
  )
    ALTER TABLE dbo.ApprovalWorkflows ADD levels NVARCHAR(MAX) NOT NULL DEFAULT '[]';

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'ApprovalWorkflows' AND COLUMN_NAME = 'active'
  )
    ALTER TABLE dbo.ApprovalWorkflows ADD active BIT NOT NULL DEFAULT 1;

  PRINT 'Patched existing dbo.ApprovalWorkflows with missing columns';
END
