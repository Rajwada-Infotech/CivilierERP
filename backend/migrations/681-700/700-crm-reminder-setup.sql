-- 700-crm-reminder-setup.sql
-- CRM Reminder Setup: who is reminded about what, when and how, kept in the database (decided 2026-11-26).
-- A rule picks a situation (what is pending: booking payment, an instalment, the agreement ...; the check itself lives
-- in services/crmReminderEngine.js), a start (booking date / due date / demand date) and an offset in days, how often
-- it repeats and when it escalates, the staff to tell (roles, chosen users, the booking's salesperson) and the
-- customer channels with their own wording. The engine logs every send (one row per occurrence and channel, which also
-- stops a second send) and clears a reminder when its situation is resolved. A booking's reminders can be paused.
-- Starting data: the overdue-instalment reminder the salesperson already gets (moved out of crmSlaEngine.js, active)
-- and the booking-payment reminder 7 days after booking (inactive, to review first). Idempotent.

IF OBJECT_ID('dbo.CrmReminderRule', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CrmReminderRule (
    Id INT IDENTITY(1,1) CONSTRAINT PK_CrmReminderRule PRIMARY KEY,
    Name NVARCHAR(150) NOT NULL,
    Situation NVARCHAR(50) NOT NULL,          -- a key of SITUATIONS in services/crmReminderEngine.js
    ProjectId INT NULL,                        -- NULL = every project
    StartFrom NVARCHAR(30) NOT NULL,           -- BookingDate | DueDate | DemandDate (the situation says which it allows)
    OffsetDays INT NOT NULL CONSTRAINT DF_CrmReminderRule_Offset DEFAULT 0,  -- negative = before the start
    RepeatEveryDays INT NULL,                  -- NULL = once
    MaxTimes INT NULL,                         -- NULL = while it stays pending
    EscalateAfterDays INT NULL,                -- days after the start; NULL = no escalation
    NotifyBookingOwner BIT NOT NULL CONSTRAINT DF_CrmReminderRule_Owner DEFAULT 0,
    Notes NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_CrmReminderRule_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmReminderRule_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT CK_CrmReminderRule_Repeat CHECK (RepeatEveryDays IS NULL OR RepeatEveryDays >= 1),
    CONSTRAINT CK_CrmReminderRule_Max CHECK (MaxTimes IS NULL OR MaxTimes >= 1),
    CONSTRAINT CK_CrmReminderRule_Escalate CHECK (EscalateAfterDays IS NULL OR EscalateAfterDays >= 0)
  );
END
GO

-- Staff who are told: a role (every active user of it), or one user; at the reminder or at the escalation.
IF OBJECT_ID('dbo.CrmReminderRecipient', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CrmReminderRecipient (
    Id INT IDENTITY(1,1) CONSTRAINT PK_CrmReminderRecipient PRIMARY KEY,
    RuleId INT NOT NULL CONSTRAINT FK_CrmReminderRecipient_Rule FOREIGN KEY REFERENCES dbo.CrmReminderRule(Id),
    Stage NVARCHAR(10) NOT NULL,               -- Remind | Escalate
    RoleId INT NULL,
    UserId INT NULL,
    CONSTRAINT CK_CrmReminderRecipient_One CHECK ((RoleId IS NOT NULL AND UserId IS NULL) OR (RoleId IS NULL AND UserId IS NOT NULL)),
    CONSTRAINT CK_CrmReminderRecipient_Stage CHECK (Stage IN (N'Remind', N'Escalate'))
  );
  CREATE INDEX IX_CrmReminderRecipient_Rule ON dbo.CrmReminderRecipient(RuleId);
END
GO

-- How each audience is told, and in what words. Staff: Bell (the bell and the staff phone apps). Customer: App (push to
-- the Civilier Home app), Portal (its "needs you" list), SMS, WhatsApp, Email (sent through the Communicator settings).
-- Title / Body take {fields} (see SITUATIONS). WhatsApp outside the 24-hour window needs a provider-approved template:
-- TemplateName + TemplateLanguage; its parameters are the {fields} of Body, in order.
IF OBJECT_ID('dbo.CrmReminderChannel', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CrmReminderChannel (
    Id INT IDENTITY(1,1) CONSTRAINT PK_CrmReminderChannel PRIMARY KEY,
    RuleId INT NOT NULL CONSTRAINT FK_CrmReminderChannel_Rule FOREIGN KEY REFERENCES dbo.CrmReminderRule(Id),
    Audience NVARCHAR(10) NOT NULL,            -- Staff | Customer
    Channel NVARCHAR(20) NOT NULL,             -- Bell | App | Portal | SMS | WhatsApp | Email
    Title NVARCHAR(200) NULL,
    Body NVARCHAR(1000) NOT NULL,
    TemplateName NVARCHAR(100) NULL,
    TemplateLanguage NVARCHAR(20) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_CrmReminderChannel_IsActive DEFAULT 1,
    CONSTRAINT CK_CrmReminderChannel_Audience CHECK (Audience IN (N'Staff', N'Customer')),
    CONSTRAINT CK_CrmReminderChannel_Channel CHECK (Channel IN (N'Bell', N'App', N'Portal', N'SMS', N'WhatsApp', N'Email')),
    CONSTRAINT UQ_CrmReminderChannel UNIQUE (RuleId, Audience, Channel)
  );
END
GO

-- Every send: one row per rule, record, occurrence, stage and channel (unique, so a reminder is never sent twice).
-- Recipient: the user id, the mobile / e-mail, or the booking for app / portal. Status: Sent | NotSent | Failed.
-- ClearedAt: set when the situation is resolved (the portal stops showing it).
IF OBJECT_ID('dbo.CrmReminderLog', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CrmReminderLog (
    Id BIGINT IDENTITY(1,1) CONSTRAINT PK_CrmReminderLog PRIMARY KEY,
    RuleId INT NOT NULL CONSTRAINT FK_CrmReminderLog_Rule FOREIGN KEY REFERENCES dbo.CrmReminderRule(Id),
    BookingId INT NOT NULL,
    EntityKey NVARCHAR(60) NOT NULL,           -- what the reminder is about, e.g. milestone:123 or booking:45
    Occurrence INT NOT NULL,                   -- 1, 2, 3 ... (0 = the escalation)
    Stage NVARCHAR(10) NOT NULL,               -- Remind | Escalate
    Audience NVARCHAR(10) NOT NULL,
    Channel NVARCHAR(20) NOT NULL,
    Recipient NVARCHAR(200) NOT NULL,
    Title NVARCHAR(200) NULL,
    Body NVARCHAR(1000) NULL,
    Status NVARCHAR(10) NOT NULL,
    Detail NVARCHAR(300) NULL,
    SentAt DATETIME2 NOT NULL CONSTRAINT DF_CrmReminderLog_SentAt DEFAULT SYSDATETIME(),
    ClearedAt DATETIME2 NULL,
    CONSTRAINT UQ_CrmReminderLog UNIQUE (RuleId, EntityKey, Occurrence, Stage, Channel, Recipient)
  );
  CREATE INDEX IX_CrmReminderLog_Booking ON dbo.CrmReminderLog(BookingId, SentAt);
  CREATE INDEX IX_CrmReminderLog_Day ON dbo.CrmReminderLog(SentAt) INCLUDE (RuleId, Channel, Status);
END
GO

-- A booking's reminders paused by staff: every rule (RuleId NULL) or one, until a date (NULL = until resumed).
IF OBJECT_ID('dbo.CrmReminderPause', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CrmReminderPause (
    Id INT IDENTITY(1,1) CONSTRAINT PK_CrmReminderPause PRIMARY KEY,
    BookingId INT NOT NULL,
    RuleId INT NULL CONSTRAINT FK_CrmReminderPause_Rule FOREIGN KEY REFERENCES dbo.CrmReminderRule(Id),
    Reason NVARCHAR(500) NOT NULL,
    PausedUntil DATE NULL,
    PausedBy INT NULL,
    PausedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmReminderPause_At DEFAULT SYSDATETIME(),
    EndedBy INT NULL,
    EndedAt DATETIME2 NULL
  );
  CREATE INDEX IX_CrmReminderPause_Booking ON dbo.CrmReminderPause(BookingId);
END
GO

-- The page key for the Reminder Setup screen (rights are granted per role on Menu Rights).
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'crm-reminder-setup')
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'crm-reminder-setup', N'Reminder Setup', N'CRM', N'CRM Setup', N'view,create,edit,delete', 885, 1, N'migration-700', SYSDATETIME());
GO

-- Starting data (only on a database that has no reminder rule yet).
IF NOT EXISTS (SELECT 1 FROM dbo.CrmReminderRule)
BEGIN
  DECLARE @overdue INT, @booking INT;

  -- 1. What crmSlaEngine.js did in code, now a rule: the day after an instalment falls due and every day after while it
  --    is unpaid, the booking's salesperson is told (bell and phone). Active, so nothing changes for them.
  INSERT INTO dbo.CrmReminderRule (Name, Situation, StartFrom, OffsetDays, RepeatEveryDays, NotifyBookingOwner, Notes, IsActive, CreatedBy)
  VALUES (N'Payment milestone overdue', N'instalmentDue', N'DueDate', 1, 1, 1,
          N'Moved from the fixed CRM SLA check (migration 700). Same as before: the salesperson, daily, from the day after the due date.', 1, NULL);
  SET @overdue = SCOPE_IDENTITY();
  INSERT INTO dbo.CrmReminderChannel (RuleId, Audience, Channel, Title, Body)
  VALUES (@overdue, N'Staff', N'Bell', N'Payment Overdue', N'{CustomerName} · {BookingNo} — {Milestone} overdue ({Amount} pending)');

  -- 2. The booking payment, 7 days after the booking: the Director role and the customer. Inactive until reviewed.
  INSERT INTO dbo.CrmReminderRule (Name, Situation, StartFrom, OffsetDays, RepeatEveryDays, NotifyBookingOwner, Notes, IsActive, CreatedBy)
  VALUES (N'Booking payment not received', N'bookingPayment', N'BookingDate', 7, 7, 1,
          N'Starting rule (migration 700): review the recipients, channels and wording, then switch it on.', 0, NULL);
  SET @booking = SCOPE_IDENTITY();
  INSERT INTO dbo.CrmReminderRecipient (RuleId, Stage, RoleId)
  SELECT @booking, N'Remind', r.RId FROM dbo.Role r WHERE LOWER(LTRIM(RTRIM(r.RName))) = N'director';
  INSERT INTO dbo.CrmReminderChannel (RuleId, Audience, Channel, Title, Body) VALUES
    (@booking, N'Staff', N'Bell', N'Booking payment pending', N'{CustomerName} · {BookingNo} — booking payment {Amount} not received {DaysSinceStart} days after booking.'),
    (@booking, N'Customer', N'App', N'Your booking payment is pending', N'{Amount} for {Project} {Unit} ({BookingNo}) is still to be paid.'),
    (@booking, N'Customer', N'Portal', N'Your booking payment is pending', N'{Amount} for {Project} {Unit} ({BookingNo}) is still to be paid.'),
    (@booking, N'Customer', N'SMS', NULL, N'Dear {CustomerName}, your booking payment of {Amount} for {Project} {Unit} ({BookingNo}) is pending. Please pay at the earliest.'),
    (@booking, N'Customer', N'WhatsApp', NULL, N'Dear {CustomerName}, your booking payment of {Amount} for {Project} {Unit} ({BookingNo}) is pending. Please pay at the earliest.');
  PRINT 'Migration 700: seeded 2 reminder rules.';
END
GO

PRINT '700-crm-reminder-setup applied successfully.';
GO
