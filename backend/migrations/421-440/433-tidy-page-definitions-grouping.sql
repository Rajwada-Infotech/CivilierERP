-- Migration 433: tidy up dbo.PageDefinitions' Module/GroupName categorization.
--
-- MenuRights.tsx's "All modules" view groups pages by GroupName alone
-- (see groupedPages in MenuRights.tsx), not scoped per-module first — so
-- two different modules using the exact same GroupName get visually
-- merged into one section there. Found three real issues on audit:
--
-- 1. CRM's "Finance" group (crm-money-receipts, crm-invoices) collides
--    with the actual Finance module's own "Finance" group. CRM's other
--    groups already follow a "CRM <Area>" convention (CRM Setup, CRM
--    Pipeline, CRM Documents, ...) — this one didn't.
-- 2. Civil Work DPR had two groups meaning the same thing: the
--    established "Civil Work DPR Setup" and a stray "Setup Masters".
-- 3. customer-master was the lone row in its own "Masters" module/group —
--    but the real app nav (TopNavbar.tsx's financeSetupItems) already
--    places Customer Master under Finance's setup dropdown alongside
--    Finance's other master pages, in the "Finance Masters" group. The
--    permission categorization should match the real navigation instead
--    of standing alone.
--
-- Matched by PageKey/Module/GroupName (not PageDefId — not stable across
-- environments), same convention as every other data-migration in this
-- backend.

UPDATE dbo.PageDefinitions
  SET GroupName = 'CRM Finance'
  WHERE Module = 'CRM' AND GroupName = 'Finance';

UPDATE dbo.PageDefinitions
  SET GroupName = 'Civil Work DPR Setup'
  WHERE Module = 'Civil Work DPR' AND GroupName = 'Setup Masters';

UPDATE dbo.PageDefinitions
  SET Module = 'Finance', GroupName = 'Finance Masters'
  WHERE PageKey = 'customer-master';

PRINT 'Tidied CRM Finance / Civil Work DPR Setup / customer-master page definitions';
GO
