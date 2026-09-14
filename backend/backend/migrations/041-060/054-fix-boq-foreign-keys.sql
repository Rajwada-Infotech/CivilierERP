-- 054-fix-boq-foreign-keys.sql
-- Align BOQ foreign keys with backend/routes/boq.js and src/pages/engineering/BOQ.tsx.

IF EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_BOQ_Company'
    AND parent_object_id = OBJECT_ID(N'dbo.BOQ')
)
BEGIN
  ALTER TABLE dbo.BOQ DROP CONSTRAINT FK_BOQ_Company;
END
GO

IF EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_BOQ_Project'
    AND parent_object_id = OBJECT_ID(N'dbo.BOQ')
)
BEGIN
  ALTER TABLE dbo.BOQ DROP CONSTRAINT FK_BOQ_Project;
END
GO

IF EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_BOQ_DocType'
    AND parent_object_id = OBJECT_ID(N'dbo.BOQ')
)
BEGIN
  ALTER TABLE dbo.BOQ DROP CONSTRAINT FK_BOQ_DocType;
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'dbo.enterprise'))
AND NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_BOQ_Company_Enterprise'
    AND parent_object_id = OBJECT_ID(N'dbo.BOQ')
)
BEGIN
  ALTER TABLE dbo.BOQ
    ADD CONSTRAINT FK_BOQ_Company_Enterprise
    FOREIGN KEY (CompanyId) REFERENCES dbo.enterprise(id);
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'dbo.enterprise'))
AND NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_BOQ_Project_Enterprise'
    AND parent_object_id = OBJECT_ID(N'dbo.BOQ')
)
BEGIN
  ALTER TABLE dbo.BOQ
    ADD CONSTRAINT FK_BOQ_Project_Enterprise
    FOREIGN KEY (ProjectId) REFERENCES dbo.enterprise(id);
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'dbo.TypeOfDoc'))
AND NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_BOQ_TypeOfDoc'
    AND parent_object_id = OBJECT_ID(N'dbo.BOQ')
)
BEGIN
  ALTER TABLE dbo.BOQ
    ADD CONSTRAINT FK_BOQ_TypeOfDoc
    FOREIGN KEY (DocTypeId) REFERENCES dbo.TypeOfDoc(TypeOfDocId);
END
GO

PRINT '054-fix-boq-foreign-keys completed.';
