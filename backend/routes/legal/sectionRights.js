"use strict";
// Edit rights per land section (migration 710). Each of the 12 sections has its own page right
// "legal-land-sec-<section>". When the user's role / user rights include an entry for that section, it decides
// create / edit / delete there; otherwise the land's own right (legal-land-master) applies — so nothing changes until
// an administrator sets section rights in Role Rights.
const { getEffectivePagePermissions } = require("../../middleware/permissions");
const { hasFullAccess } = require("../../middleware/role");

const LAND_PAGE = "legal-land-master";
// Master → section (same sections as the land page / verification).
const SECTION_OF = {
  land: "basic", "ownership-record": "ownership", inheritance: "ownership", partition: "ownership", "property-restriction": "ownership",
  "ownership-event": "acquisition", "land-purchase": "acquisition", "land-rs-record": "records", "land-lr-record": "records",
  "legal-case": "legal", "case-hearing": "legal", "land-legal-record": "legal", mortgage: "loans", mutation: "mutation", "mutation-record": "mutation",
  "mutation-hearing": "mutation", payment: "payments", "land-tax": "tax", valuation: "survey", "land-photo": "photos",
};
const SECTIONS = ["basic", "ownership", "acquisition", "records", "legal", "loans", "mutation", "payments", "tax", "survey", "documents", "photos"];

/** { section: { view, create, edit, delete } } for this user (true for full-access roles). */
async function sectionRights(req) {
  const role = String(req.user?.role || "").toLowerCase();
  if (hasFullAccess(role)) return Object.fromEntries(SECTIONS.map((s) => [s, { view: true, create: true, edit: true, delete: true, own: false }]));
  const eff = await getEffectivePagePermissions(req.user?.userId ?? req.user?.id, req.user?.roleId);
  const acts = (page) => { const r = eff.find((x) => String(x?.page || "").toLowerCase() === page); return r ? (r.actions || []).map((a) => String(a).toLowerCase()) : null; };
  const land = acts(LAND_PAGE) || [];
  return Object.fromEntries(SECTIONS.map((s) => {
    const own = acts(`legal-land-sec-${s}`);
    const a = own || land;
    return [s, { view: a.includes("view") || land.includes("view"), create: a.includes("create") || (!own && a.includes("edit")), edit: a.includes("edit"), delete: a.includes("delete"), own: !!own }];
  }));
}

/** Can this user do `action` (create / edit / delete) on `section`? */
async function canSection(req, section, action) {
  if (!section) return true;
  const r = (await sectionRights(req))[section];
  return !!r?.[action];
}

module.exports = { SECTION_OF, SECTIONS, sectionRights, canSection };
