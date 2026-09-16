-- Migration 448: Salary Structure Template fields -- turns the simple
-- Company/Name/Code + Head/Percentage/Amount structure built earlier into
-- a full formula-driven payroll template (header: Description, Effective
-- From/To, CTC Frequency, Version; lines: Calculation Type/Base/Formula,
-- Min/Max, Rounding, Sequence, Include-in-Gross/CTC/Net, Taxable,
-- Balancing). All additions are nullable or defaulted so existing rows
-- and the app code already reading Percentage/Amount keep working.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructure') AND name = 'Description')
  ALTER TABLE dbo.SalaryStructure ADD Description NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructure') AND name = 'EffectiveFrom')
  ALTER TABLE dbo.SalaryStructure ADD EffectiveFrom DATE NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructure') AND name = 'EffectiveTo')
  ALTER TABLE dbo.SalaryStructure ADD EffectiveTo DATE NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructure') AND name = 'CTCFrequency')
  ALTER TABLE dbo.SalaryStructure ADD CTCFrequency NVARCHAR(10) NOT NULL
    CONSTRAINT DF_SalaryStructure_CTCFrequency DEFAULT N'Monthly';
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SalaryStructure_CTCFrequency')
  ALTER TABLE dbo.SalaryStructure ADD CONSTRAINT CK_SalaryStructure_CTCFrequency
    CHECK (CTCFrequency IN (N'Annual', N'Monthly'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructure') AND name = 'Version')
  ALTER TABLE dbo.SalaryStructure ADD Version INT NOT NULL
    CONSTRAINT DF_SalaryStructure_Version DEFAULT 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructureLines') AND name = 'CalculationType')
  ALTER TABLE dbo.SalaryStructureLines ADD CalculationType NVARCHAR(20) NOT NULL
    CONSTRAINT DF_SalaryStructureLines_CalcType DEFAULT N'Fixed';
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SalaryStructureLines_CalcType')
  ALTER TABLE dbo.SalaryStructureLines ADD CONSTRAINT CK_SalaryStructureLines_CalcType
    CHECK (CalculationType IN (N'Fixed', N'Percentage', N'Formula'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructureLines') AND name = 'CalculationBase')
  ALTER TABLE dbo.SalaryStructureLines ADD CalculationBase NVARCHAR(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructureLines') AND name = 'Formula')
  ALTER TABLE dbo.SalaryStructureLines ADD Formula NVARCHAR(500) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructureLines') AND name = 'MinAmount')
  ALTER TABLE dbo.SalaryStructureLines ADD MinAmount DECIMAL(18,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructureLines') AND name = 'MaxAmount')
  ALTER TABLE dbo.SalaryStructureLines ADD MaxAmount DECIMAL(18,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructureLines') AND name = 'RoundingRule')
  ALTER TABLE dbo.SalaryStructureLines ADD RoundingRule NVARCHAR(10) NOT NULL
    CONSTRAINT DF_SalaryStructureLines_Rounding DEFAULT N'None';
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SalaryStructureLines_Rounding')
  ALTER TABLE dbo.SalaryStructureLines ADD CONSTRAINT CK_SalaryStructureLines_Rounding
    CHECK (RoundingRule IN (N'None', N'Nearest', N'Up', N'Down'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructureLines') AND name = 'Sequence')
  ALTER TABLE dbo.SalaryStructureLines ADD Sequence INT NOT NULL
    CONSTRAINT DF_SalaryStructureLines_Sequence DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructureLines') AND name = 'IncludeInGross')
  ALTER TABLE dbo.SalaryStructureLines ADD IncludeInGross BIT NOT NULL
    CONSTRAINT DF_SalaryStructureLines_InGross DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructureLines') AND name = 'IncludeInCTC')
  ALTER TABLE dbo.SalaryStructureLines ADD IncludeInCTC BIT NOT NULL
    CONSTRAINT DF_SalaryStructureLines_InCTC DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructureLines') AND name = 'IncludeInNet')
  ALTER TABLE dbo.SalaryStructureLines ADD IncludeInNet BIT NOT NULL
    CONSTRAINT DF_SalaryStructureLines_InNet DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructureLines') AND name = 'Taxable')
  ALTER TABLE dbo.SalaryStructureLines ADD Taxable BIT NOT NULL
    CONSTRAINT DF_SalaryStructureLines_Taxable DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructureLines') AND name = 'IsBalancing')
  ALTER TABLE dbo.SalaryStructureLines ADD IsBalancing BIT NOT NULL
    CONSTRAINT DF_SalaryStructureLines_Balancing DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SalaryStructureLines') AND name = 'IsActive')
  ALTER TABLE dbo.SalaryStructureLines ADD IsActive BIT NOT NULL
    CONSTRAINT DF_SalaryStructureLines_IsActive DEFAULT 1;
GO

-- At most one balancing line per structure.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_SalaryStructureLines_OneBalancing')
  CREATE UNIQUE INDEX UQ_SalaryStructureLines_OneBalancing
    ON dbo.SalaryStructureLines(SalaryStructureId) WHERE IsBalancing = 1;
GO

PRINT '448-salary-structure-template-fields applied successfully.';
GO
