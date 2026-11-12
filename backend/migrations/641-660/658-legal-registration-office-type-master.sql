-- 658: Registration Office Type becomes a Setup master, so the deed search works anywhere in India.
--   Each type has its own time limit, the first calendar year searched, an optional State (blank = every state) and
--   whether every new enquiry gets a search timeline for it. A new enquiry gets one timeline per active type that
--   applies to its district's state. Registration offices and office timelines point at the type by id.
-- Reference list: the West Bengal types already in use (ADSR, DSR, RA Calcutta, BLRO on enquiries; ARA, Registrar,
-- Sub-Registrar, Other for offices only).
IF OBJECT_ID('dbo.LegalRegistrationOfficeType', 'U') IS NULL
CREATE TABLE dbo.LegalRegistrationOfficeType (
  OfficeTypeId   INT IDENTITY(1,1) CONSTRAINT PK_LegalRegistrationOfficeType PRIMARY KEY,
  TypeName       NVARCHAR(60) NOT NULL,
  Code           NVARCHAR(20) NULL,
  StateName      NVARCHAR(100) NULL,
  SlaDays        INT NOT NULL CONSTRAINT CK_LegalRegistrationOfficeType_Days CHECK (SlaDays BETWEEN 1 AND 365),
  FromYear       INT NOT NULL CONSTRAINT DF_LegalRegistrationOfficeType_From DEFAULT 1956,
  OnEnquiry      BIT NOT NULL CONSTRAINT DF_LegalRegistrationOfficeType_OnEnq DEFAULT 1,
  Description    NVARCHAR(500) NULL,
  SortOrder      INT NOT NULL CONSTRAINT DF_LegalRegistrationOfficeType_Sort DEFAULT 0,
  IsActive       BIT NOT NULL CONSTRAINT DF_LegalRegistrationOfficeType_Active DEFAULT 1,
  CreatedBy      INT NULL,
  CreatedAt      DATETIME2 NOT NULL CONSTRAINT DF_LegalRegistrationOfficeType_At DEFAULT SYSUTCDATETIME(),
  UpdatedBy      INT NULL,
  UpdatedAt      DATETIME2 NULL,
  CONSTRAINT UQ_LegalRegistrationOfficeType UNIQUE (TypeName, StateName)
);
GO
MERGE dbo.LegalRegistrationOfficeType AS t
USING (VALUES
  (N'ADSR', N'ADSR', N'West Bengal', 7, 1956, 1, N'Additional District Sub-Registrar', 1),
  (N'DSR', N'DSR', N'West Bengal', 7, 1956, 1, N'District Sub-Registrar', 2),
  (N'RA Calcutta', N'RAC', N'West Bengal', 10, 1956, 1, N'Registrar of Assurances, Kolkata', 3),
  (N'BLRO', N'BLRO', N'West Bengal', 1, 1956, 1, N'Block Land & Land Reforms Office', 4),
  (N'ARA', N'ARA', N'West Bengal', 7, 1956, 0, N'Additional Registrar of Assurances', 5),
  (N'Registrar', N'REG', NULL, 7, 1956, 0, NULL, 6),
  (N'Sub-Registrar', N'SR', NULL, 7, 1956, 0, NULL, 7),
  (N'Other', N'OTH', NULL, 7, 1956, 0, NULL, 8)
) AS s (TypeName, Code, StateName, SlaDays, FromYear, OnEnquiry, Description, SortOrder)
ON t.TypeName = s.TypeName AND ISNULL(t.StateName, N'') = ISNULL(s.StateName, N'')
WHEN NOT MATCHED THEN INSERT (TypeName, Code, StateName, SlaDays, FromYear, OnEnquiry, Description, SortOrder)
  VALUES (s.TypeName, s.Code, s.StateName, s.SlaDays, s.FromYear, s.OnEnquiry, s.Description, s.SortOrder);
GO
-- Keep any limit already changed in the old table.
IF OBJECT_ID('dbo.LegalRegistryOfficeSla', 'U') IS NOT NULL
  UPDATE t SET SlaDays = s.Days FROM dbo.LegalRegistrationOfficeType t JOIN dbo.LegalRegistryOfficeSla s ON s.OfficeType = t.TypeName;
GO
IF COL_LENGTH('dbo.LegalRegistrationOffice', 'OfficeTypeId') IS NULL ALTER TABLE dbo.LegalRegistrationOffice ADD OfficeTypeId INT NULL;
IF COL_LENGTH('dbo.LegalEnquiryOfficeSearch', 'OfficeTypeId') IS NULL ALTER TABLE dbo.LegalEnquiryOfficeSearch ADD OfficeTypeId INT NULL;
IF COL_LENGTH('dbo.LegalEnquiryOfficeSearch', 'FromYear') IS NULL ALTER TABLE dbo.LegalEnquiryOfficeSearch ADD FromYear INT NOT NULL CONSTRAINT DF_LegalEnquiryOfficeSearch_From DEFAULT 1956;
GO
UPDATE o SET OfficeTypeId = t.OfficeTypeId FROM dbo.LegalRegistrationOffice o
  CROSS APPLY (SELECT TOP 1 OfficeTypeId FROM dbo.LegalRegistrationOfficeType x WHERE x.TypeName = o.OfficeType
               ORDER BY CASE WHEN x.StateName = o.State THEN 0 WHEN x.StateName IS NULL THEN 1 ELSE 2 END) t
  WHERE o.OfficeTypeId IS NULL;
UPDATE s SET OfficeTypeId = t.OfficeTypeId FROM dbo.LegalEnquiryOfficeSearch s
  CROSS APPLY (SELECT TOP 1 OfficeTypeId FROM dbo.LegalRegistrationOfficeType x WHERE x.TypeName = s.OfficeType ORDER BY x.SortOrder) t
  WHERE s.OfficeTypeId IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'legal-registration-office-type-master')
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'legal-registration-office-type-master', N'Registration Office Types', N'Legal', N'Legal Masters - Registration', N'view,create,edit,delete,print,export', 161, 1, N'migration-658', SYSDATETIME());
GO
