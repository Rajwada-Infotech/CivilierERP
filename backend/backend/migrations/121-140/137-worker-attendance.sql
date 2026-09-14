-- Worker Attendance Management — a stable Worker identity (tied to a
-- Contractor/company) so attendance can be tracked, searched, and
-- summarized across days/months, instead of relying on free-text names
-- re-typed on every Daily Labour entry.

IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'Worker' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.Worker (
    WorkerId          INT IDENTITY(1,1) PRIMARY KEY,
    Name               NVARCHAR(150) NOT NULL,
    ContractorLHeadId  INT NOT NULL,
    SkillType          NVARCHAR(20) NOT NULL DEFAULT 'Skilled',
    IsActive           BIT NOT NULL DEFAULT 1,
    CreatedBy          NVARCHAR(150) NULL,
    CreatedAt          DATETIME2 NOT NULL DEFAULT GETDATE(),
    UpdatedBy          NVARCHAR(150) NULL,
    UpdatedAt          DATETIME2 NULL,
    CONSTRAINT FK_Worker_Contractor FOREIGN KEY (ContractorLHeadId) REFERENCES dbo.AccountHeadMaster(LHeadId)
  );
  CREATE INDEX IX_Worker_Contractor ON dbo.Worker(ContractorLHeadId);
  PRINT 'Created dbo.Worker';
END
GO

IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'WorkerAttendance' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.WorkerAttendance (
    AttendanceId    INT IDENTITY(1,1) PRIMARY KEY,
    WorkerId        INT NOT NULL,
    AllocationId    INT NOT NULL,
    AttendanceDate  DATE NOT NULL,
    -- P = Present, A = Absent, H = Half Day
    Status          CHAR(1) NOT NULL DEFAULT 'P',
    Remarks         NVARCHAR(300) NULL,
    CreatedBy       NVARCHAR(150) NULL,
    CreatedAt       DATETIME2 NOT NULL DEFAULT GETDATE(),
    UpdatedBy       NVARCHAR(150) NULL,
    UpdatedAt       DATETIME2 NULL,
    CONSTRAINT FK_WorkerAttendance_Worker FOREIGN KEY (WorkerId) REFERENCES dbo.Worker(WorkerId),
    CONSTRAINT FK_WorkerAttendance_Allocation FOREIGN KEY (AllocationId) REFERENCES dbo.ContractorAllocation(AllocationId),
    -- One attendance status per worker per day, regardless of which
    -- activity/allocation they were logged against that day.
    CONSTRAINT UQ_WorkerAttendance_Worker_Date UNIQUE (WorkerId, AttendanceDate)
  );
  CREATE INDEX IX_WorkerAttendance_Worker ON dbo.WorkerAttendance(WorkerId);
  CREATE INDEX IX_WorkerAttendance_Allocation ON dbo.WorkerAttendance(AllocationId);
  CREATE INDEX IX_WorkerAttendance_Date ON dbo.WorkerAttendance(AttendanceDate);
  PRINT 'Created dbo.WorkerAttendance';
END
GO

-- PageDefinitions — new Worker Attendance page under Civil Work DPR
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions'
)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'civilworkdpr-worker-attendance' AND IsActive = 1)
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
    VALUES ('civilworkdpr-worker-attendance', 'Worker Attendance', 'Civil Work DPR', 'Civil Work DPR', 'view,create,edit,delete', 14, 1, 'migration', GETDATE());

  PRINT 'Seeded civilworkdpr-worker-attendance';
END
GO
