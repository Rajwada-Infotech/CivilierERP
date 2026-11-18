-- 693: Face self-registration from the Employee Portal app, approved by HR. Schema only; safe to re-run.
--  • Source: who captured it — 'HR' (Employee Master webcam) or 'Self' (employee, Employee Portal app).
--  • A self-registration is saved as Pending with one encrypted review photo for HR; HR approves (→ Active, the old
--    Active becomes Replaced) or rejects (→ Rejected). The review photo is erased once HR decides.
IF COL_LENGTH('dbo.EmployeeFaceTemplate', 'Source') IS NULL
  ALTER TABLE dbo.EmployeeFaceTemplate ADD
    Source        NVARCHAR(10) NOT NULL CONSTRAINT DF_EmployeeFaceTemplate_Source DEFAULT N'HR',
    ReviewPhoto   VARBINARY(MAX) NULL,
    ProfileScore  DECIMAL(6,4) NULL,
    DecidedBy     INT NULL CONSTRAINT FK_EmployeeFaceTemplate_DecidedBy REFERENCES dbo.users (id),
    DecidedAt     DATETIME2(0) NULL;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EmployeeFaceTemplate_Status')
  ALTER TABLE dbo.EmployeeFaceTemplate DROP CONSTRAINT CK_EmployeeFaceTemplate_Status;
ALTER TABLE dbo.EmployeeFaceTemplate ADD CONSTRAINT CK_EmployeeFaceTemplate_Status CHECK (Status IN (N'Pending', N'Active', N'Revoked', N'Replaced', N'Rejected'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EmployeeFaceTemplate_Pending')
  CREATE INDEX IX_EmployeeFaceTemplate_Pending ON dbo.EmployeeFaceTemplate (Status, EnrolledAt) WHERE Status = N'Pending';
GO
PRINT '693-face-self-registration applied successfully.';
GO
