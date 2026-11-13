-- 665: Instalment schedule templates (Setup) and percentage instalments.
--   • Setup → Instalment Schedule Templates: one row per instalment line — template name, order, label, % of the
--     consideration, days after the consideration date, purpose. A land's schedule can be made from a template.
--   • A land's instalment may be a percentage (amount = % × consideration, re-worked when the consideration is revised)
--     or a fixed amount.
-- Schema + two reference templates (editable in Setup).
IF OBJECT_ID('dbo.LegalInstalmentTemplate', 'U') IS NULL
CREATE TABLE dbo.LegalInstalmentTemplate (
  LineId        INT IDENTITY(1,1) CONSTRAINT PK_LegalInstalmentTemplate PRIMARY KEY,
  TemplateName  NVARCHAR(100) NOT NULL,
  SeqNo        INT NOT NULL,
  Label         NVARCHAR(100) NOT NULL,
  SharePct       DECIMAL(9,4) NOT NULL CONSTRAINT CK_LegalInstalmentTemplate_Pct CHECK (SharePct > 0 AND SharePct <= 100),
  DueDays       INT NOT NULL CONSTRAINT DF_LegalInstalmentTemplate_Days DEFAULT 0,
  TxnTypeId     INT NULL,
  Remarks       NVARCHAR(500) NULL,
  IsActive      BIT NOT NULL CONSTRAINT DF_LegalInstalmentTemplate_Active DEFAULT 1,
  CreatedBy     INT NULL,
  CreatedAt     DATETIME2 NOT NULL CONSTRAINT DF_LegalInstalmentTemplate_At DEFAULT SYSUTCDATETIME(),
  UpdatedBy     INT NULL,
  UpdatedAt     DATETIME2 NULL,
  CONSTRAINT UQ_LegalInstalmentTemplate UNIQUE (TemplateName, SeqNo)
);
GO
IF COL_LENGTH('dbo.LegalPaymentSchedule', 'SharePct') IS NULL ALTER TABLE dbo.LegalPaymentSchedule ADD SharePct DECIMAL(9,4) NULL;
IF COL_LENGTH('dbo.LegalPaymentSchedule', 'Label') IS NULL ALTER TABLE dbo.LegalPaymentSchedule ADD Label NVARCHAR(100) NULL;
GO
MERGE dbo.LegalInstalmentTemplate AS t
USING (VALUES
  (N'Advance 10% + balance at registration', 1, N'Advance on agreement', 10, 0, N'Advance'),
  (N'Advance 10% + balance at registration', 2, N'Balance at registration', 90, 30, N'Final Payment'),
  (N'Three instalments 20 / 40 / 40', 1, N'Advance on agreement', 20, 0, N'Advance'),
  (N'Three instalments 20 / 40 / 40', 2, N'Second instalment', 40, 60, N'Purchase Payment'),
  (N'Three instalments 20 / 40 / 40', 3, N'Balance at registration', 40, 120, N'Final Payment')
) AS s (TemplateName, SeqNo, Label, SharePct, DueDays, Purpose)
ON t.TemplateName = s.TemplateName AND t.SeqNo = s.SeqNo
WHEN NOT MATCHED THEN INSERT (TemplateName, SeqNo, Label, SharePct, DueDays, TxnTypeId)
  VALUES (s.TemplateName, s.SeqNo, s.Label, s.SharePct, s.DueDays, (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'txn-type' AND Name = s.Purpose));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'legal-instalment-template-master')
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'legal-instalment-template-master', N'Instalment Schedule Templates', N'Legal', N'Legal Masters - Legal & Financial', N'view,create,edit,delete,print,export', 165, 1, N'migration-665', SYSDATETIME());
GO
