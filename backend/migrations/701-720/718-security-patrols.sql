-- Migration 718: patrol rounds (Civilier Security app).
-- A guard on shift taps "Start patrol" on the home page and "End patrol" when the round is done. The route itself is
-- the guard's location pings (dbo.SecurityGuardPing) between the two times; this table only records the round, so
-- residents of that project can pick a patrol and replay it. A round left open ends by itself after 4 hours.
-- Safe to re-run.

IF OBJECT_ID('dbo.SecurityPatrol', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityPatrol (
    PatrolId     INT IDENTITY(1,1) PRIMARY KEY,
    GuardUserId  INT           NOT NULL,
    GateId       INT           NOT NULL CONSTRAINT FK_SecurityPatrol_Gate REFERENCES dbo.SecurityGate(GateId),
    ProjectId    INT           NOT NULL,
    StartedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_SecurityPatrol_StartedAt DEFAULT SYSUTCDATETIME(),
    EndedAt      DATETIME2(0)  NULL,
    CONSTRAINT CK_SecurityPatrol_Times CHECK (EndedAt IS NULL OR EndedAt >= StartedAt)
  );
  CREATE INDEX IX_SecurityPatrol_Guard ON dbo.SecurityPatrol (GuardUserId, StartedAt DESC);
  CREATE INDEX IX_SecurityPatrol_Project ON dbo.SecurityPatrol (ProjectId, StartedAt DESC);
END
GO
