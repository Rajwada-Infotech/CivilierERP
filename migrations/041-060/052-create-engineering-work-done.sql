-- 052-create-engineering-work-done.sql
-- Run this batch in SSMS to add the Engineering > Work Done table.

IF NOT EXISTS (
  SELECT 1
  FROM sys.tables
  WHERE object_id = OBJECT_ID(N'dbo.EngineeringWorkDone')
)
BEGIN
  CREATE TABLE dbo.EngineeringWorkDone (
    ID                INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EngineeringWorkDone PRIMARY KEY,
    DocNo             NVARCHAR(100) NULL,
    DocTypeId         INT NULL,
    DocDate           DATE NULL,
    CompanyId         INT NULL,
    ProjectId         INT NULL,
    FinYear           NVARCHAR(20) NULL,
    SupplierId        INT NULL,
    WorkOrderID       INT NULL,
    PeriodFrom        DATE NULL,
    PeriodTo          DATE NULL,
    DescriptionOfWork NVARCHAR(MAX) NULL,
    QuantityDone      DECIMAL(18,4) NOT NULL CONSTRAINT DF_EngineeringWorkDone_QuantityDone DEFAULT 0,
    Unit              NVARCHAR(50) NULL,
    RatePerUnit       DECIMAL(18,4) NOT NULL CONSTRAINT DF_EngineeringWorkDone_RatePerUnit DEFAULT 0,
    GrossAmount       DECIMAL(18,2) NOT NULL CONSTRAINT DF_EngineeringWorkDone_GrossAmount DEFAULT 0,
    Deductions        DECIMAL(18,2) NOT NULL CONSTRAINT DF_EngineeringWorkDone_Deductions DEFAULT 0,
    CertifiedAmount   DECIMAL(18,2) NOT NULL CONSTRAINT DF_EngineeringWorkDone_CertifiedAmount DEFAULT 0,
    Status            NVARCHAR(50) NOT NULL CONSTRAINT DF_EngineeringWorkDone_Status DEFAULT 'Draft',
    Remarks           NVARCHAR(MAX) NULL,
    CreatedBy         NVARCHAR(100) NULL,
    CreatedAt         DATETIME2 NOT NULL CONSTRAINT DF_EngineeringWorkDone_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy         NVARCHAR(100) NULL,
    UpdatedAt         DATETIME2 NULL
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.EngineeringWorkDone')
    AND name = N'IX_EngineeringWorkDone_DocNo'
)
  CREATE INDEX IX_EngineeringWorkDone_DocNo
    ON dbo.EngineeringWorkDone(DocNo)
    WHERE DocNo IS NOT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.EngineeringWorkDone')
    AND name = N'IX_EngineeringWorkDone_Status_CreatedAt'
)
  CREATE INDEX IX_EngineeringWorkDone_Status_CreatedAt
    ON dbo.EngineeringWorkDone(Status, CreatedAt DESC);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.EngineeringWorkDone')
    AND name = N'IX_EngineeringWorkDone_Company_Project'
)
  CREATE INDEX IX_EngineeringWorkDone_Company_Project
    ON dbo.EngineeringWorkDone(CompanyId, ProjectId);
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'dbo.TypeOfDoc'))
AND NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_EngineeringWorkDone_DocType'
)
BEGIN
  ALTER TABLE dbo.EngineeringWorkDone
    ADD CONSTRAINT FK_EngineeringWorkDone_DocType
    FOREIGN KEY (DocTypeId) REFERENCES dbo.TypeOfDoc(TypeOfDocId);
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'dbo.enterprise'))
AND NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_EngineeringWorkDone_Company'
)
BEGIN
  ALTER TABLE dbo.EngineeringWorkDone
    ADD CONSTRAINT FK_EngineeringWorkDone_Company
    FOREIGN KEY (CompanyId) REFERENCES dbo.enterprise(id);
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'dbo.enterprise'))
AND NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_EngineeringWorkDone_Project'
)
BEGIN
  ALTER TABLE dbo.EngineeringWorkDone
    ADD CONSTRAINT FK_EngineeringWorkDone_Project
    FOREIGN KEY (ProjectId) REFERENCES dbo.enterprise(id);
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'dbo.AccountHeadMaster'))
AND NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_EngineeringWorkDone_Supplier'
)
BEGIN
  ALTER TABLE dbo.EngineeringWorkDone
    ADD CONSTRAINT FK_EngineeringWorkDone_Supplier
    FOREIGN KEY (SupplierId) REFERENCES dbo.AccountHeadMaster(LHeadId);
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'dbo.WorkOrderHeader'))
AND NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_EngineeringWorkDone_WorkOrder'
)
BEGIN
  ALTER TABLE dbo.EngineeringWorkDone
    ADD CONSTRAINT FK_EngineeringWorkDone_WorkOrder
    FOREIGN KEY (WorkOrderID) REFERENCES dbo.WorkOrderHeader(Id);
END
GO

DECLARE @AnyEntryType UNIQUEIDENTIFIER =
  (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt);

IF @AnyEntryType IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM dbo.TypeOfDoc
  WHERE IsActive = 1
    AND (DocNoPrefix = 'WD' OR links_to LIKE '%Work Done%')
)
BEGIN
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive,
     EntryTypeId, links_to, ModuleCode, FinYearReset, CreatedBy, CreatedAt)
  VALUES
    ('WD', 'WD', 'Work Done', 1, 5, 1,
     @AnyEntryType, 'Work Done', 'WD', 1, 'migration-052', SYSDATETIME());
END
GO

PRINT '052-create-engineering-work-done completed.';
