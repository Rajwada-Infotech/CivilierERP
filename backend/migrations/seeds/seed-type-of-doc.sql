-- Seed: dbo.TypeOfDoc — the full set of document-numbering types currently
-- live in the Civilier DB (all 21 are global templates: CompanyId and
-- ProjectId are NULL, so they apply across every company/project rather
-- than being scoped to one). Used by backend/utils/docNumberLock.js via
-- MODULE_LINKS in routes/document-type.js to drive every module's doc
-- numbering (PO, WO, GRN, Task Master, etc.).
--
-- EntryTypeId values are fixed classification GUIDs — there's no backing
-- lookup table for them in this schema (checked: no dbo.NamedEntryType or
-- similar exists), so they're hardcoded here exactly as stored, matching
-- what's already live.
--
-- Idempotent — only inserts a Prefix that doesn't already exist.

INSERT INTO dbo.TypeOfDoc (
  Prefix, Description, EntryTypeId, CompanyId, ProjectId, StartingDocNo,
  DocNoPrefix, DocNoPadding, links_to, ModuleCode, FinYearReset, IsActive,
  CreatedBy, CreatedAt
)
SELECT v.Prefix, v.Description, v.EntryTypeId, NULL, NULL, 1,
       v.DocNoPrefix, v.DocNoPadding, v.links_to, v.ModuleCode, 1, 1,
       'seed-type-of-doc', SYSUTCDATETIME()
FROM (VALUES
  ('REQ', 'Material Request',              '6DA51BA9-06A1-44C6-881F-7C3F3C19F6F4', 'REQ', 5, 'Material Request',            'MAT'),
  ('PO',  'Purchase Order',                '784E475A-D1DF-4F11-B563-6BD5AD374EA4', 'PO',  5, 'Purchase Order',              'MAT'),
  ('GRN', 'Goods Receipt Note',            'FC582F7D-A5E6-46E3-8285-AFBEC1B76D97', 'GRN', 5, 'GRN',                         'MAT'),
  ('ISS', 'Material Issue',                '0B5C9CD7-3A4F-41A2-B7B8-243B57398033', 'ISS', 5, 'Material Issue',              'MAT'),
  ('INV', 'Expense Booking',               '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'INV', 5, 'Expense Booking',             'MAT'),
  ('VEH', 'Vehicle In/Out',                '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'VEH', 5, 'Vehicle In/Out',              'VEH'),
  ('PAY', 'Payment',                       '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'PAY', 5, 'Payment',                     NULL),
  ('REC', 'Received Payment',              '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'REC', 5, 'Received Payment',            NULL),
  ('BOQ', 'Bill of Quantities',            '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'BOQ', 4, 'BOQ',                         'BOQ'),
  ('WO',  'Work Order',                    '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'WO',  5, 'Work Order',                  'WO'),
  ('WD',  'Work Done',                     '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'WD',  5, 'Work Done',                   'WD'),
  ('SI',  'Sale Invoice',                  '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'SI',  5, 'Sale Invoice',                'SI'),
  ('DPO', 'Direct Purchase Order',         '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'DPO', 5, 'Purchase Order',              NULL),
  ('QT',  'Quotation',                     '784E475A-D1DF-4F11-B563-6BD5AD374EA4', 'QT',  5, 'Quotation',                   'QT'),
  ('JV',  'Journal Voucher',               '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'JV',  5, 'Journal Voucher',             NULL),
  ('ICT', 'Inter-Company Stock Transfer',  '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'ICT', 5, 'Inter-Company Transfer',      NULL),
  ('SO',  'Sale Order',                    '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'SO',  5, 'Sale Order',                  NULL),
  ('QPO', 'Quotation Purchase Order',      '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'QPO', 5, 'Purchase Order',              NULL),
  ('CON', 'Contract',                      '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'CON', 5, 'Contract',                    NULL),
  ('FA',  'Fixed Asset Record',            '0B5C9CD7-3A4F-41A2-B7B8-243B57398033', 'FA',  5, NULL,                          NULL),
  ('QDN', 'Quality Rejection Debit Note',  '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE', 'QDN', 5, 'Vehicle In/Out',              'QDN')
) AS v(Prefix, Description, EntryTypeId, DocNoPrefix, DocNoPadding, links_to, ModuleCode)
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.TypeOfDoc t
  WHERE t.Prefix = v.Prefix AND t.CompanyId IS NULL AND t.ProjectId IS NULL
);
GO
