-- The standalone "Project Bank Mapping" page (CrmProjectBanks.tsx,
-- /crm/setup/project-banks) was removed — tagging now happens from Bank
-- Master's own "Tag Project(s)" section instead. This pageKey ('crm-
-- project-banks') is still very much live and required though: it's the
-- permission gate on crmProjectBanks.js's GET /for-project and /for-bank
-- lookups, which every deposit/refund bank picker across CRM (Application,
-- Booking, Booking Detail, Payment Milestones, Cancellations) calls. Only
-- relabeling it so it no longer reads, in the Role/permissions admin
-- screen, as a page that exists and can be opened.
UPDATE dbo.PageDefinitions
SET Label = 'Project Bank Scoping (used by Bank Master + CRM payment pickers)',
    GroupName = 'CRM'
WHERE PageKey = 'crm-project-banks' AND IsActive = 1;
