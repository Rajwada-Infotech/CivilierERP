-- Migration 575: a small profile-picture thumbnail for lists.
--
-- users.avatar_url holds the full uploaded picture (up to ~400 KB as a data
-- URI). The Users list and the Activity Browser load every user's picture at
-- once, so they now use a small compressed square thumbnail (made in the
-- browser at upload, ~112 px JPEG, a few KB) instead. The full picture stays
-- for the profile page. Pictures uploaded before this get their thumbnail the
-- first time the Users page shows them. Safe to run again.
IF COL_LENGTH(N'dbo.users', N'avatar_thumb') IS NULL
  ALTER TABLE dbo.users ADD avatar_thumb NVARCHAR(MAX) NULL;
GO
