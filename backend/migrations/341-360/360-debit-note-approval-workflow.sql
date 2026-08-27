-- Migration 360: Debit Note now goes through the Approval Inbox
--
-- Migration 359 auto-approved every Debit Note on save and posted its GL
-- effect immediately. Debit Notes now follow the same Draft -> Pending ->
-- Approved|Rejected workflow as every other financial document (see
-- backend/services/approvalService.js MODULE_MAP/GL_POSTERS) — GL posting
-- now happens only once an approver clears it from the Approval Inbox.
--
-- Fixes the TypeOfDoc.links_to label seeded by migration 359 (was
-- 'Expense Booking Invoice', which doesn't match the 'Debit Note'
-- MODULE_DOC_LINKS entry approvalService.js's startup validator checks
-- against — cosmetic/validation-only, no functional impact until now).
--
-- Safe to run multiple times.

UPDATE dbo.TypeOfDoc
  SET links_to = 'Debit Note'
  WHERE DocNoPrefix = 'DN' AND links_to <> 'Debit Note';
GO

PRINT '================================================================';
PRINT '360-debit-note-approval-workflow applied successfully.';
PRINT '================================================================';
GO
