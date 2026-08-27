-- Migration 363: Department on Asset Transfer.
--
-- Adds DepartmentId to dbo.AssetTransferHistory so every transfer snapshots
-- the department it was made to at that point in time (full history is
-- preserved even if the receiving user's own department changes later).
-- Sourced from the existing dbo.DepartmentMaster — no separate department
-- list is introduced.

IF COL_LENGTH('dbo.AssetTransferHistory', 'DepartmentId') IS NULL
BEGIN
  ALTER TABLE dbo.AssetTransferHistory ADD DepartmentId INT NULL
    CONSTRAINT FK_ATH_Department REFERENCES dbo.DepartmentMaster(Id);
END
GO
