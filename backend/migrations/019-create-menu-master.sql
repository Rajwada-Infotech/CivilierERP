-- Migration: Create dbo.MenuMaster
-- Run this in SSMS against your CivilierERP database

CREATE TABLE dbo.MenuMaster (
  Id          INT IDENTITY(1,1) PRIMARY KEY,
  Name        NVARCHAR(200)  NOT NULL,
  Description NVARCHAR(500)  NULL,
  CreatedBy   INT            NULL,
  UpdatedBy   INT            NULL,
  CreatedAt   DATETIME2(3)   NULL DEFAULT GETDATE(),
  UpdatedAt   DATETIME2(3)   NULL
);
