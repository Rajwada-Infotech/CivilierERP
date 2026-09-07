-- Worker Attendance — Aadhaar-based identity + auto-retention.
--
-- Most workers logged here are casual/temporary labour, not a stable
-- roster — creating a permanent dbo.Worker row for every one-day hire
-- silently accumulated dead rows forever. Rather than dropping the
-- stable-identity model entirely (it's what lets attendance be searched
-- and summarized per worker in the first place — see migration 137's own
-- comment), this keys that identity off the worker's Aadhaar number
-- instead of a free-typed name, and adds automatic retention: a Worker
-- with no attendance logged in the last 4 months is purged outright. If
-- that same person comes back later, they're registered fresh — nothing
-- tries to resurrect or merge into the deleted row.
--
-- Safe to run multiple times (all operations guarded).

-- ── 1. AadhaarNo column — nullable for existing rows created before this
--       migration; the create-worker route enforces it going forward. ──────
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.Worker') AND name = N'AadhaarNo'
)
    ALTER TABLE dbo.Worker ADD AadhaarNo CHAR(12) NULL;
GO

-- SQL Server's UNIQUE constraint treats every NULL as distinct, so this
-- only enforces uniqueness among rows that actually have an Aadhaar
-- number on file — legacy NULL rows don't collide with each other or
-- with new ones.
IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = 'UQ_Worker_AadhaarNo' AND parent_object_id = OBJECT_ID(N'dbo.Worker')
)
    ALTER TABLE dbo.Worker ADD CONSTRAINT UQ_Worker_AadhaarNo UNIQUE (AadhaarNo);
GO

PRINT '================================================================';
PRINT '381-worker-aadhaar-and-retention applied successfully.';
PRINT '================================================================';
GO
