-- Room Master (dbo.RoomMaster via routes/roomMaster.js, already the shared
-- backend for Civil Work DPR's own Dependency/Location masters) moves out of
-- the CRM module's Setup dropdown and into Civil Work DPR's Setup dropdown.
-- The frontend route changes from /crm/setup/room-master to
-- /civilworkdpr/room-master and the page file moves from
-- src/pages/admin/masters/RoomMaster.tsx to src/pages/civilworkdpr/RoomMaster.tsx.
--
-- Renaming the pageKey (rather than keeping "followup-room-master") so Menu
-- Rights and requirePageRight's module-prefix matching reflect where the
-- page actually lives now — same pattern as migration 239's CRM Setup
-- pageKey migration. Follows that migration's safety approach: rename in
-- PageDefinitions, then sweep the same rename across UserPageRightsJson and
-- RoleRights so any existing grants carry forward instead of being silently
-- dropped.

UPDATE dbo.PageDefinitions
   SET PageKey = 'civilworkdpr-room-master', Label = N'Room Master', Module = N'Civil Work DPR', GroupName = N'Civil Work DPR Setup', UpdatedAt = SYSDATETIME()
 WHERE PageKey = 'followup-room-master';

-- In case the CRM-era key from migration 239 ('crm-room-master') is the one
-- actually live in this environment instead, rename that too — idempotent
-- either way since only a matching row (if any) is touched.
UPDATE dbo.PageDefinitions
   SET PageKey = 'civilworkdpr-room-master', Label = N'Room Master', Module = N'Civil Work DPR', GroupName = N'Civil Work DPR Setup', UpdatedAt = SYSDATETIME()
 WHERE PageKey = 'crm-room-master';

UPDATE dbo.UserPageRightsJson
   SET RightsJson = REPLACE(RightsJson, '"followup-room-master"', '"civilworkdpr-room-master"')
 WHERE RightsJson LIKE '%"followup-room-master"%';

UPDATE dbo.UserPageRightsJson
   SET RightsJson = REPLACE(RightsJson, '"crm-room-master"', '"civilworkdpr-room-master"')
 WHERE RightsJson LIKE '%"crm-room-master"%';

UPDATE dbo.RoleRights SET Module = 'Civil Work DPR', SubModule = 'civilworkdpr-room-master' WHERE SubModule = 'followup-room-master';
UPDATE dbo.RoleRights SET Module = 'Civil Work DPR', SubModule = 'civilworkdpr-room-master' WHERE SubModule = 'crm-room-master';

PRINT 'Room Master pageKey migrated to civilworkdpr-room-master (PageDefinitions, UserPageRightsJson, RoleRights).';
