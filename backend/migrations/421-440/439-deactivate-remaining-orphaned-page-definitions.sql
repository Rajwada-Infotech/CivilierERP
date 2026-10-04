-- Migration 439: deactivate the last 2 orphaned PageDefinitions rows
-- missed by migration 438's automated scan (they were excluded there
-- because a substring-match grep found "hits" for them, but on closer
-- inspection those hits were incidental, not real usePageRights() calls).
--
--   - 'amendments' (Module: Material) - the real Material Amendment
--     page (MaterialSidebar.ts, path /material/amendment) checks
--     pageKey "material-amendment", not "amendments". The earlier
--     grep hits for "amendments" were CRM's CrmBookingAmendments.tsx
--     (gated by "crm-bookings") and unrelated files with "amendment"
--     in their name - not a real reference to this key.
--   - 'civilworkdpr-activity' (Module: Civil Work DPR) - the real
--     Activity Reporting page checks pageKey
--     "civilworkdpr-activity-reporting", not "civilworkdpr-activity".

UPDATE dbo.PageDefinitions SET IsActive = 0 WHERE PageKey IN (
  'amendments', 'civilworkdpr-activity'
);

PRINT 'Deactivated 2 remaining orphaned PageDefinitions rows';
GO
