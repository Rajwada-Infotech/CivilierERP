-- Migration 520: the Resale page speaks of buyers, not investors.
--
-- People who buy plots are buyers; when one sells on to another it is a
-- resale. Migration 515 seeded the page label as "Plot Resale (Investor
-- Exit)", which shows in the menu and the page-rights screens. Relabel it.
-- Safe to re-run.

UPDATE dbo.PageDefinitions
SET Label = 'Plot Resale'
WHERE PageKey = 'crm-resales' AND Label <> 'Plot Resale';

PRINT 'Migration 520: crm-resales page labelled "Plot Resale".';
