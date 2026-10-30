"use strict";

// Legal module masters: one config entry per master drives the table it reads and writes,
// server-side validation, and the form the Setup page renders (served by GET /api/legal/masters/meta).
//
// Field types: text, textarea, url, int, decimal, date, bit, select (options), ref (another master,
// or "project" / "role" / "user"). `filterBy` on a ref narrows its choices to the chosen parent
// (RS Khatian by Mouza); the server also checks the pair matches. `blankOk` also allows rows whose parent
// is blank (a checklist meant for any deed type). `fill` copies columns of the picked row into empty fields
// of the form ({ FormField: "ColumnOfPickedRow" }): picking an RS plot fills its area and land class.
// `label` on a master is the SQL expression shown wherever another master picks a row from it.
// `file` is an uploaded document (POST /api/legal/masters/files), stored as its LegalMasterFile id.
// `mask: "aadhaar"` keeps the number out of lists and exports (XXXX XXXX 1234); saving the masked value
// back leaves the stored number as it was. `scope` lets several masters share one table, each seeing
// only its own rows (Buyer, Seller, Owner, Customer and Witness are all rows of LegalPerson).
//
// Operational records (Land Management) use the same engine:
//   `auto: "LND"` on a text field generates the next number on add (LND-2026-00001) and is never edited;
//   `parent: "LandId"` lets GET /:master?parent=ID return one land property's rows (its RS / LR records, parties);
//   `derived` keeps an older text column in step with a picked row ({ name: "District", from: "DistrictId", column: "DistrictName" });
//   `noDelete` records are never physically deleted (mark them inactive or cancel them instead);
//   `guard(pool, id, values)` returns an error message to refuse an update (a converted enquiry is read-only);
//   `lookupOnly` masters only feed pickers (no page of their own);
//   `review: { field, by, at }` — setting `field` off Pending needs the approve right and stamps who / when.
// A `label` is evaluated with the master's table aliased as r.
// Decimal fields take `min`, `maxValue` and `signed` (GPS coordinates).

const LAND_CLASSES = ["Sali", "Suna", "Danga", "Bastu", "Doba", "Pukur", "Bagan", "Khamar", "Karkhana", "Commercial", "Others"];
const ACTIVE = { name: "IsActive", label: "Status", type: "bit", default: true };
const PAN = { name: "Pan", label: "PAN", type: "text", max: 10, upper: true, pattern: "^[A-Z]{5}[0-9]{4}[A-Z]$", patternMsg: "PAN must look like ABCDE1234F" };
const EMAIL = { name: "Email", label: "Email", type: "text", max: 150, pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", patternMsg: "Enter a valid email" };
const PHONE = { name: "Phone", label: "Phone", type: "text", max: 15, pattern: "^[+]?[0-9 -]{8,15}$", patternMsg: "Enter a valid phone number" };
const LAND_DOC = [
  { name: "LandDocTypeId", label: "Land record document", type: "ref", ref: "document-type" },
  { name: "LandDocNo", label: "Related document number", type: "text", max: 60 },
  { name: "LandDocFileId", label: "Land record document copy", type: "file" },
];

// Short code / name lists (Ownership Type, Payment Mode…): every one is rows of LegalLookupValue, by Category.
const lookup = (key, title, group, desc) => ({
  title, group, pageKey: `legal-${key}-master`, table: "LegalLookupValue", pk: "LookupId",
  scope: { column: "Category", value: key }, desc,
  label: "Name", orderBy: "SortOrder, Name",
  unique: [["Category", "Name"], `This ${title.toLowerCase()} already exists`],
  fields: [
    { name: "Name", label: "Name", type: "text", required: true, max: 150 },
    { name: "Code", label: "Code", type: "text", max: 30, upper: true },
    { name: "Description", label: "Description", type: "textarea", max: 500 },
    { name: "SortOrder", label: "Sort order", type: "int", min: 0, default: 0 },
    ACTIVE,
  ],
});

const VERIFICATION = { name: "VerificationStatus", label: "Verification", type: "select", required: true, options: ["Pending", "Verified", "Rejected", "Needs Correction"], default: "Pending" };
const REVIEW = { field: "VerificationStatus", by: "VerifiedBy", at: "VerifiedAt" };
const LAND_ID = { name: "LandId", label: "Land property", type: "ref", ref: "land", required: true };
// A land's own records (opened from the land's page): the parent column, the page right and the group.
const landChild = (title, table, pk, desc, rest) => ({
  title, group: "Land Management", pageKey: "legal-land-master", table, pk, parent: "LandId", desc, ...rest,
});
const OWNERSHIP_CHECKS = ["Identity document checked", "Previous ownership document checked", "Transfer document checked",
  "Relationship document checked", "Ownership share checked", "Date continuity checked", "Current ownership checked"];

// Buyer, Seller, Owner, Customer and Witness: the same person record, kept apart by PersonRole.
const person = (role, title, desc, { landDocs = true } = {}) => ({
  title, group: "Parties", pageKey: `legal-${role.toLowerCase()}-master`, table: "LegalPerson", pk: "PersonId",
  scope: { column: "PersonRole", value: role }, desc,
  label: "FullName + ISNULL(' (' + Pan + ')', '')", orderBy: "FullName",
  unique: [["PersonRole", "Pan"], `A ${title.toLowerCase()} with this PAN or Aadhaar already exists`],
  fields: [
    { name: "FullName", label: "Full name (as on ID)", type: "text", required: true, max: 200 },
    { name: "PartyType", label: "Party type", type: "select", required: true, options: ["Individual", "Company", "Organization"], default: "Individual" },
    { name: "GuardianName", label: "Father / husband / guardian name", type: "text", max: 200 },
    { name: "DateOfBirth", label: "Date of birth", type: "date" },
    { name: "Gender", label: "Gender", type: "select", options: ["Male", "Female", "Other"] },
    PAN,
    { name: "Aadhaar", label: "Aadhaar number", type: "text", max: 14, mask: "aadhaar" },
    PHONE,
    EMAIL,
    { name: "Address", label: "Address", type: "textarea", max: 500 },
    { name: "IdProofFileId", label: "PAN / Aadhaar copy", type: "file" },
    ...(landDocs ? LAND_DOC : []),
    { name: "Remarks", label: "Remarks", type: "textarea", max: 500 },
    ACTIVE,
  ],
});

const MASTERS = {
  // ── Land records ────────────────────────────────────────────────────────────────────────────────
  mouza: {
    title: "Mouza", group: "Land records", pageKey: "legal-mouza-master", table: "LegalMouza", pk: "MouzaId",
    desc: "The officially recognised revenue village a land parcel sits in.",
    label: "MouzaName + ' (J.L. ' + ISNULL(JLNo, '-') + ')'", orderBy: "District, MouzaName",
    // The deed screens still read the text columns, so they follow the picks.
    derived: [
      { name: "District", from: "DistrictId", column: "DistrictName" },
      { name: "SubDivision", from: "SubDivisionId", column: "SubDivisionName" },
      { name: "Block", from: "BlockId", column: "BlockName" },
      { name: "PoliceStation", from: "PoliceStationId", column: "StationName" },
    ],
    unique: [["MouzaName", "JLNo", "District"], "This Mouza and J.L. number already exist in this district"],
    fields: [
      { name: "MouzaName", label: "Mouza name", type: "text", required: true, max: 150 },
      { name: "JLNo", label: "J.L. number", type: "text", required: true, max: 30 },
      { name: "DistrictId", label: "District", type: "ref", ref: "district", required: true },
      { name: "SubDivisionId", label: "Sub-division", type: "ref", ref: "sub-division", filterBy: "DistrictId" },
      { name: "BlockId", label: "Block", type: "ref", ref: "block", filterBy: "DistrictId" },
      { name: "PoliceStationId", label: "Police station", type: "ref", ref: "police-station", filterBy: "DistrictId" },
      { name: "Pincode", label: "Pincode", type: "text", max: 10, pattern: "^[0-9]{6}$", patternMsg: "Pincode must be 6 digits" },
      { name: "Remarks", label: "Remarks", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },
  "rs-khatian": {
    title: "RS Khatian", group: "Land records", pageKey: "legal-rs-khatian-master", table: "LegalRsKhatian", pk: "RsKhatianId",
    desc: "Revisional Survey Record of Rights (Khatian): the account number of a landholder's records.",
    label: "'Khatian ' + KhatianNo + ISNULL(' - ' + HolderName, '')", orderBy: "MouzaId, KhatianNo",
    unique: [["MouzaId", "KhatianNo"], "This RS Khatian number already exists in this Mouza"],
    fields: [
      { name: "MouzaId", label: "Mouza", type: "ref", ref: "mouza", required: true },
      { name: "KhatianNo", label: "RS Khatian number", type: "text", required: true, max: 30 },
      { name: "HolderName", label: "Recorded holder", type: "text", required: true, max: 200 },
      { name: "GuardianName", label: "Father / husband name", type: "text", max: 200 },
      { name: "HolderAddress", label: "Holder address", type: "textarea", max: 500 },
      { name: "Share", label: "Share (e.g. 1/2, 0.25)", type: "text", max: 30 },
      { name: "Remarks", label: "Remarks", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },
  "rs-plot": {
    title: "RS Plot", group: "Land records", pageKey: "legal-rs-plot-master", table: "LegalRsPlot", pk: "RsPlotId",
    desc: "Revisional Survey plot (Dag) numbers, with their Khatian, land class, area and project.",
    label: "'RS Dag ' + PlotNo", orderBy: "MouzaId, PlotNo",
    unique: [["MouzaId", "PlotNo"], "This RS plot number already exists in this Mouza"],
    fields: [
      { name: "MouzaId", label: "Mouza", type: "ref", ref: "mouza", required: true },
      { name: "PlotNo", label: "RS plot (Dag) number", type: "text", required: true, max: 30 },
      { name: "RsKhatianId", label: "RS Khatian", type: "ref", ref: "rs-khatian", filterBy: "MouzaId" },
      { name: "LandClass", label: "Land class", type: "select", options: LAND_CLASSES },
      { name: "Area", label: "Area", type: "decimal" },
      { name: "AreaUnitId", label: "Area unit", type: "ref", ref: "area-unit", requiredWith: "Area" },
      { name: "ProjectId", label: "Project", type: "ref", ref: "project" },
      { name: "ParcelStatus", label: "Parcel status", type: "select", options: ["Identified", "Under Negotiation", "Agreement Done", "Registered", "Mutated", "Dropped"], default: "Identified" },
      { name: "Remarks", label: "Remarks", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },
  "lr-ror": {
    title: "LR Record of Rights", group: "Land records", pageKey: "legal-lr-ror-master", table: "LegalLrRor", pk: "LrRorId",
    desc: "Land Reforms Record of Rights (Parcha): the official record of the holder and the parcel.",
    label: "'LR Khatian ' + LrKhatianNo + ' / Dag ' + LrPlotNo", orderBy: "MouzaId, LrKhatianNo, LrPlotNo",
    unique: [["MouzaId", "LrKhatianNo", "LrPlotNo"], "This LR Khatian and plot are already recorded in this Mouza"],
    fields: [
      { name: "MouzaId", label: "Mouza", type: "ref", ref: "mouza", required: true },
      { name: "LrKhatianNo", label: "LR Khatian number", type: "text", required: true, max: 30 },
      { name: "LrPlotNo", label: "LR plot (Dag) number", type: "text", required: true, max: 30 },
      { name: "RsPlotId", label: "Matching RS plot", type: "ref", ref: "rs-plot", filterBy: "MouzaId", fill: { LandClass: "LandClass", Area: "Area", AreaUnitId: "AreaUnitId" } },
      { name: "HolderName", label: "Recorded holder", type: "text", required: true, max: 200 },
      { name: "GuardianName", label: "Father / husband name", type: "text", max: 200 },
      { name: "LandClass", label: "Land class", type: "select", options: LAND_CLASSES },
      { name: "Area", label: "Area", type: "decimal" },
      { name: "AreaUnitId", label: "Area unit", type: "ref", ref: "area-unit", requiredWith: "Area" },
      { name: "Share", label: "Share", type: "text", max: 30 },
      { name: "RorDate", label: "RoR date (as on)", type: "date" },
      { name: "CopyType", label: "Copy type", type: "select", options: ["Certified Copy", "Online / Digital", "Photocopy", "Not Obtained"] },
      { name: "Source", label: "Source", type: "text", max: 200 },
      { name: "Remarks", label: "Remarks", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },
  "area-unit": {
    title: "Area Unit", group: "Land records", pageKey: "legal-area-unit-master", table: "LegalAreaUnit", pk: "AreaUnitId",
    desc: "Land area units and their conversion to square feet, for consistent area reporting.",
    label: "UnitName", orderBy: "SqFtFactor",
    unique: [["UnitCode"], "This unit code already exists"],
    fields: [
      { name: "UnitCode", label: "Unit code", type: "text", required: true, max: 20, upper: true },
      { name: "UnitName", label: "Unit name", type: "text", required: true, max: 60 },
      { name: "SqFtFactor", label: "Square feet in one unit", type: "decimal", required: true, min: 0.000001 },
      { name: "DecimalPlaces", label: "Decimal places", type: "int", min: 0, max: 6, default: 4 },
      ACTIVE,
    ],
  },

  "land-type": {
    title: "Land Type", group: "Land records", pageKey: "legal-land-type-master", table: "LegalLandType", pk: "LandTypeId",
    desc: "Classes of land as recorded (Sali, Bastu, Danga…) and whether building on it needs conversion.",
    label: "LandTypeName", orderBy: "LandTypeName",
    unique: [["LandTypeCode"], "This land type code already exists"],
    fields: [
      { name: "LandTypeCode", label: "Code", type: "text", required: true, max: 20, upper: true },
      { name: "LandTypeName", label: "Land type", type: "text", required: true, max: 100 },
      { name: "ConversionNeeded", label: "Needs conversion before building", type: "bit", default: false },
      { name: "Description", label: "Description", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },
  land: {
    title: "Land Property", group: "Land Management", pageKey: "legal-land-master", table: "LegalLand", pk: "LandId",
    desc: "The central record of a land property: every enquiry, record, party, document and step hangs off its Land ID.",
    label: "LandCode + ' - ' + LandName", orderBy: "LandCode",
    unique: [["LandCode"], "This Land ID already exists"],
    noDelete: true,
    fields: [
      { name: "LandCode", label: "Land ID", type: "text", max: 30, auto: "LND" },
      { name: "LandName", label: "Land title / name", type: "text", required: true, max: 200 },
      { name: "DistrictId", label: "District", type: "ref", ref: "district", required: true },
      { name: "SubDivisionId", label: "Sub-division", type: "ref", ref: "sub-division", filterBy: "DistrictId" },
      { name: "BlockId", label: "Block", type: "ref", ref: "block", filterBy: "DistrictId" },
      { name: "VillageId", label: "Village", type: "ref", ref: "village", filterBy: "DistrictId", fill: { PoliceStationId: "PoliceStationId", MunicipalityId: "MunicipalityId", MouzaId: "MouzaId", BlockId: "BlockId" } },
      { name: "MouzaId", label: "Mouza", type: "ref", ref: "mouza", required: true, filterBy: "DistrictId", blankOk: true },
      { name: "PoliceStationId", label: "Police station", type: "ref", ref: "police-station", filterBy: "DistrictId" },
      { name: "MunicipalityId", label: "Municipality / local body", type: "ref", ref: "municipality", filterBy: "DistrictId" },
      { name: "Area", label: "Total land area", type: "decimal", required: true, min: 0.000001 },
      { name: "AreaUnitId", label: "Area unit", type: "ref", ref: "area-unit", required: true },
      { name: "LandTypeId", label: "Land classification", type: "ref", ref: "land-type" },
      { name: "LocationTypeId", label: "Location type", type: "ref", ref: "location-type" },
      { name: "ProjectId", label: "Project", type: "ref", ref: "project" },
      { name: "LandStatus", label: "Land status", type: "select", required: true, options: ["Identified", "Under Negotiation", "Agreement Done", "Registered", "Mutated", "In Dispute", "Dropped"], default: "Identified" },
      { name: "ChecklistTemplateId", label: "Document checklist", type: "ref", ref: "checklist-template" },
      { name: "LocationAddress", label: "Land location (full address)", type: "textarea", max: 1000 },
      { name: "NorthBoundary", label: "North boundary", type: "text", max: 300 },
      { name: "SouthBoundary", label: "South boundary", type: "text", max: 300 },
      { name: "EastBoundary", label: "East boundary", type: "text", max: 300 },
      { name: "WestBoundary", label: "West boundary", type: "text", max: 300 },
      { name: "GpsLatitude", label: "GPS latitude", type: "decimal", signed: true, min: -90, maxValue: 90 },
      { name: "GpsLongitude", label: "GPS longitude", type: "decimal", signed: true, min: -180, maxValue: 180 },
      { name: "MapFileId", label: "Land map", type: "file" },
      ...LAND_DOC,
      { name: "Remarks", label: "Internal remarks", type: "textarea", max: 1000 },
      ACTIVE,
    ],
  },
  "land-enquiry": {
    title: "Land Enquiry", group: "Land Management", pageKey: "legal-land-enquiry", table: "LegalLandEnquiry", pk: "EnquiryId",
    desc: "A new land opportunity, before the full property record. Convert it to create the Land ID.",
    label: "EnquiryNo + ' - ' + LandLocation", orderBy: "EnquiryDate DESC, EnquiryId DESC",
    unique: [["EnquiryNo"], "This enquiry number already exists"],
    noDelete: true,
    guard: async (pool, id, values) => {
      const r = await pool.request().input("Id", id).query("SELECT EnquiryStatus, (SELECT LandCode FROM dbo.LegalLand l WHERE l.LandId = e.LandId) AS LandCode FROM dbo.LegalLandEnquiry e WHERE EnquiryId = @Id");
      const row = r.recordset[0];
      if (row?.EnquiryStatus === "Converted to Land Record") return `This enquiry is already converted to ${row.LandCode || "a land record"}; update the land property instead`;
      if (values.EnquiryStatus === "Converted to Land Record") return "Use Convert to land record to convert an enquiry";
      return null;
    },
    fields: [
      { name: "EnquiryNo", label: "Enquiry number", type: "text", max: 30, auto: "ENQ" },
      { name: "EnquiryDate", label: "Enquiry date", type: "date", required: true, default: "today" },
      { name: "EnquirySourceId", label: "Enquiry source", type: "ref", ref: "enquiry-source", required: true },
      { name: "LandLocation", label: "Land location", type: "text", required: true, max: 300 },
      { name: "DistrictId", label: "District", type: "ref", ref: "district", required: true },
      { name: "MouzaId", label: "Mouza", type: "ref", ref: "mouza", required: true, filterBy: "DistrictId", blankOk: true, fill: { JLNo: "JLNo" } },
      { name: "JLNo", label: "J.L. number", type: "text", max: 30 },
      { name: "ApproxArea", label: "Approximate area", type: "decimal" },
      { name: "AreaUnitId", label: "Area unit", type: "ref", ref: "area-unit", requiredWith: "ApproxArea" },
      { name: "ContactPerson", label: "Seller / contact person", type: "text", max: 200 },
      { name: "ContactNumber", label: "Contact number", type: "text", max: 15, pattern: "^[+]?[0-9 -]{8,15}$", patternMsg: "Enter a valid phone number" },
      { name: "ExpectedPrice", label: "Expected price (₹)", type: "decimal" },
      { name: "AssignedUserId", label: "Assigned employee", type: "ref", ref: "user", required: true },
      { name: "EnquiryStatus", label: "Enquiry status", type: "select", required: true, options: ["New", "Under Review", "Interested", "Rejected", "On Hold", "Converted to Land Record"], default: "New" },
      { name: "InitialDocFileId", label: "Initial document", type: "file" },
      { name: "InitialNotes", label: "Initial notes", type: "textarea", max: 2000 },
      ACTIVE,
    ],
  },
  // One land property's RS and LR records and its parties (opened from the property's page).
  "land-rs-record": {
    title: "RS Record", group: "Land Management", pageKey: "legal-land-master", table: "LegalLandRsRecord", pk: "RsRecordId", parent: "LandId", review: REVIEW,
    desc: "Revisional Survey Khatian / Dag references of this land.",
    label: "'RS Kh ' + RsKhatianNo + ' / Dag ' + RsDagNo", orderBy: "RsKhatianNo, RsDagNo",
    unique: [["LandId", "MouzaId", "RsKhatianNo", "RsDagNo"], "This RS Khatian and Dag are already recorded for this land"],
    fields: [
      { name: "LandId", label: "Land property", type: "ref", ref: "land", required: true },
      { name: "MouzaId", label: "Mouza", type: "ref", ref: "mouza", required: true },
      { name: "RsKhatianNo", label: "RS Khatian number", type: "text", required: true, max: 30 },
      { name: "RsDagNo", label: "RS Dag number", type: "text", required: true, max: 30 },
      { name: "RecordedHolder", label: "Recorded holder", type: "text", max: 200 },
      { name: "LandTypeId", label: "Land classification", type: "ref", ref: "land-type" },
      { name: "Area", label: "Area", type: "decimal" },
      { name: "AreaUnitId", label: "Area unit", type: "ref", ref: "area-unit", requiredWith: "Area" },
      { name: "Share", label: "Share", type: "text", max: 30 },
      { name: "RecordDate", label: "RS record date", type: "date" },
      { name: "CopyTypeId", label: "Copy type", type: "ref", ref: "copy-type" },
      { name: "Source", label: "Source", type: "text", max: 200 },
      { name: "DocFileId", label: "Document", type: "file" },
      VERIFICATION,
      { name: "Remarks", label: "Reviewer remarks", type: "textarea", max: 1000 },
      ACTIVE,
    ],
  },
  "land-lr-record": {
    title: "LR Record of Rights", group: "Land Management", pageKey: "legal-land-master", table: "LegalLandLrRecord", pk: "LrRecordId", parent: "LandId", review: REVIEW,
    desc: "Land Reforms Khatian / Dag (RoR) references of this land, optionally matched to an RS record.",
    label: "'LR Kh ' + LrKhatianNo + ' / Dag ' + LrDagNo", orderBy: "LrKhatianNo, LrDagNo",
    unique: [["LandId", "MouzaId", "LrKhatianNo", "LrDagNo"], "This LR Khatian and Dag are already recorded for this land"],
    fields: [
      { name: "LandId", label: "Land property", type: "ref", ref: "land", required: true },
      { name: "MouzaId", label: "Mouza", type: "ref", ref: "mouza", required: true },
      { name: "LrKhatianNo", label: "LR Khatian number", type: "text", required: true, max: 30 },
      { name: "LrDagNo", label: "LR Dag number", type: "text", required: true, max: 30 },
      // Optional: an LR plot need not carry the RS number, and the two numbers are never assumed equal.
      { name: "MatchingRsRecordId", label: "Matching RS plot (optional)", type: "ref", ref: "land-rs-record", filterBy: "LandId" },
      { name: "RecordedHolder", label: "Recorded holder", type: "text", max: 200 },
      { name: "GuardianName", label: "Father / husband name", type: "text", max: 200 },
      { name: "LandTypeId", label: "Land classification", type: "ref", ref: "land-type" },
      { name: "Area", label: "Area", type: "decimal" },
      { name: "AreaUnitId", label: "Area unit", type: "ref", ref: "area-unit", requiredWith: "Area" },
      { name: "Share", label: "Share", type: "text", max: 30 },
      { name: "RorDate", label: "RoR date (as on)", type: "date" },
      { name: "CopyTypeId", label: "Copy type", type: "ref", ref: "copy-type" },
      { name: "Source", label: "Source", type: "text", max: 200 },
      { name: "DocFileId", label: "Document", type: "file" },
      VERIFICATION,
      { name: "Remarks", label: "Reviewer remarks", type: "textarea", max: 1000 },
      ACTIVE,
    ],
  },
  "land-party": {
    title: "Land Party", group: "Land Management", pageKey: "legal-land-master", table: "LegalLandParty", pk: "LandPartyId", parent: "LandId",
    desc: "Owners, joint owners, heirs, sellers, buyers and signatories of this land, from the Party masters.",
    label: "(SELECT FullName FROM dbo.LegalPerson p WHERE p.PersonId = r.PersonId) + ' (' + LandRole + ')'", orderBy: "LandRole, LandPartyId",
    unique: [["LandId", "PersonId", "LandRole"], "This person is already linked to this land in this role"],
    fields: [
      { name: "LandId", label: "Land property", type: "ref", ref: "land", required: true },
      { name: "PersonId", label: "Party", type: "ref", ref: "person", required: true },
      { name: "LandRole", label: "Role on this land", type: "select", required: true, options: ["Owner", "Joint Owner", "Legal Heir", "Previous Owner", "Seller", "Buyer", "Representative", "Authorized Signatory"], default: "Owner" },
      { name: "RelationshipTypeId", label: "Relationship", type: "ref", ref: "relationship-type" },
      { name: "SharePct", label: "Ownership share (%)", type: "decimal", maxValue: 100 },
      { name: "Remarks", label: "Remarks", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },
  // ── Phase 2: ownership history ──
  "ownership-event": landChild("Ownership Transfer", "LegalOwnershipEvent", "EventId",
    "Each transfer in the chain — sale, inheritance, gift, partition, court order — from previous owner to new owner.", {
      label: "CONVERT(NVARCHAR(10), r.EventDate, 105) + ' ' + ISNULL((SELECT x.Name FROM dbo.LegalLookupValue x WHERE x.LookupId = r.TransferTypeId), '') + ': ' + ISNULL((SELECT p.FullName FROM dbo.LegalPerson p WHERE p.PersonId = r.PreviousOwnerId), '?') + N' → ' + (SELECT p.FullName FROM dbo.LegalPerson p WHERE p.PersonId = r.NewOwnerId)",
      orderBy: "EventDate, EventId", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "TransferTypeId", label: "Transfer type", type: "ref", ref: "transfer-type", required: true },
        { name: "EventDate", label: "Transfer date", type: "date", required: true },
        { name: "PreviousOwnerId", label: "Previous owner", type: "ref", ref: "person" },
        { name: "NewOwnerId", label: "New owner", type: "ref", ref: "person", required: true },
        { name: "DeedNo", label: "Deed number", type: "text", max: 60 },
        { name: "RegistrationOfficeId", label: "Registration office", type: "ref", ref: "registration-office" },
        { name: "RegistrationDate", label: "Registration date", type: "date" },
        { name: "TransferArea", label: "Transfer area", type: "decimal" },
        { name: "AreaUnitId", label: "Area unit", type: "ref", ref: "area-unit", requiredWith: "TransferArea" },
        { name: "TransferSharePct", label: "Transfer share (%)", type: "decimal", maxValue: 100 },
        { name: "TransferValue", label: "Transfer value (₹)", type: "decimal" },
        { name: "DocFileId", label: "Supporting deed / document", type: "file" },
        VERIFICATION,
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "ownership-record": landChild("Ownership Record", "LegalOwnershipRecord", "RecordId",
    "Who owned what share, from when to when. A new owner is a new record; earlier records keep their end date.", {
      label: "(SELECT p.FullName FROM dbo.LegalPerson p WHERE p.PersonId = r.PersonId) + ' ' + CAST(CAST(r.SharePct AS DECIMAL(7,2)) AS NVARCHAR(10)) + '% from ' + CONVERT(NVARCHAR(10), r.ValidFrom, 105)",
      orderBy: "ValidFrom, RecordId", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "PersonId", label: "Owner", type: "ref", ref: "person", required: true },
        { name: "OwnershipTypeId", label: "Ownership type", type: "ref", ref: "ownership-type", required: true },
        { name: "RelationshipTypeId", label: "Relationship", type: "ref", ref: "relationship-type" },
        { name: "SharePct", label: "Ownership share (%)", type: "decimal", required: true, maxValue: 100 },
        { name: "ValidFrom", label: "Ownership start date", type: "date", required: true },
        { name: "ValidTo", label: "Ownership end date (blank = current)", type: "date", after: "ValidFrom" },
        { name: "EventId", label: "Created by transfer", type: "ref", ref: "ownership-event", filterBy: "LandId" },
        { name: "PreviousPersonId", label: "Previous owner", type: "ref", ref: "person" },
        { name: "TransferDocFileId", label: "Transfer document", type: "file" },
        VERIFICATION,
        { name: "VerificationRemarks", label: "Verification remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "ownership-check": landChild("Ownership Verification", "LegalOwnershipCheck", "CheckId",
    "The reviewer's result for each check on each ownership record — never just a tick box.", {
      label: "r.CheckItem", orderBy: "RecordId, CheckItem",
      unique: [["RecordId", "CheckItem"], "This check is already recorded for this ownership record"],
      review: { field: "Result", by: "VerifiedBy", at: "VerifiedAt" },
      fields: [
        LAND_ID,
        { name: "RecordId", label: "Ownership record", type: "ref", ref: "ownership-record", filterBy: "LandId", required: true },
        { name: "CheckItem", label: "Check", type: "select", required: true, options: OWNERSHIP_CHECKS },
        { name: "Result", label: "Result", type: "select", required: true, options: ["Pending", "Verified", "Rejected", "Needs Correction", "Reattachment Required", "Not Applicable"], default: "Pending" },
        { name: "Remarks", label: "Reviewer remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  inheritance: landChild("Inheritance", "LegalInheritance", "InheritanceId",
    "A deceased owner's share passing to legal heirs, with the death and heirship evidence.", {
      label: "'Estate of ' + (SELECT p.FullName FROM dbo.LegalPerson p WHERE p.PersonId = r.DeceasedPersonId)",
      orderBy: "InheritanceId", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "DeceasedPersonId", label: "Deceased owner", type: "ref", ref: "person", required: true },
        { name: "DateOfDeath", label: "Date of death", type: "date" },
        { name: "DeathCertFileId", label: "Death certificate", type: "file" },
        { name: "HeirCertFileId", label: "Legal heir certificate", type: "file" },
        { name: "SupportingType", label: "Other supporting record", type: "select", required: true, options: ["None", "Will", "Probate", "Succession Certificate", "Court Order"], default: "None" },
        { name: "SupportingFileId", label: "Supporting record copy", type: "file" },
        { name: "MutationRecordNo", label: "Mutation record number", type: "text", max: 60 },
        VERIFICATION,
        { name: "Remarks", label: "Verification remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "inheritance-heir": landChild("Legal Heir", "LegalInheritanceHeir", "HeirId",
    "The heirs of one inheritance and the share each receives.", {
      label: "(SELECT p.FullName FROM dbo.LegalPerson p WHERE p.PersonId = r.PersonId)", orderBy: "InheritanceId, HeirId",
      unique: [["InheritanceId", "PersonId"], "This heir is already listed for this inheritance"],
      fields: [
        LAND_ID,
        { name: "InheritanceId", label: "Inheritance", type: "ref", ref: "inheritance", filterBy: "LandId", required: true },
        { name: "PersonId", label: "Legal heir", type: "ref", ref: "person", required: true },
        { name: "RelationshipTypeId", label: "Relationship with deceased", type: "ref", ref: "relationship-type" },
        { name: "SharePct", label: "Inheritance share (%)", type: "decimal", required: true, maxValue: 100 },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 500 },
        ACTIVE,
      ],
    }),
  partition: landChild("Partition", "LegalPartition", "PartitionId",
    "A division of the land among co-owners, with the new Dag / Khatian references.", {
      label: "r.PartitionType + ' ' + CONVERT(NVARCHAR(10), r.PartitionDate, 105)", orderBy: "PartitionDate", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "PartitionType", label: "Partition type", type: "select", required: true, options: ["Mutual / Amicable", "Family Settlement", "Court Decree"], default: "Mutual / Amicable" },
        { name: "PartitionDate", label: "Partition date", type: "date", required: true },
        { name: "PartiesInvolved", label: "Original owner(s) and parties involved", type: "textarea", required: true, max: 1000 },
        { name: "ShareDetails", label: "Individual share / area", type: "textarea", max: 1000 },
        { name: "NewReferences", label: "New Dag / Khatian references", type: "text", max: 300 },
        { name: "DeedFileId", label: "Partition deed / court order", type: "file" },
        VERIFICATION,
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),

  // Every person of every role, for the land's party picker.
  person: {
    title: "Party", group: "Parties", pageKey: "legal-land-master", table: "LegalPerson", pk: "PersonId", lookupOnly: true,
    label: "FullName + ' - ' + PersonRole + ISNULL(' (' + Pan + ')', '')", orderBy: "FullName",
    fields: [],
  },

  // ── Locations ───────────────────────────────────────────────────────────────────────────────────
  district: {
    title: "District", group: "Locations", pageKey: "legal-district-master", table: "LegalDistrict", pk: "DistrictId",
    desc: "Districts the company's land and registration offices sit in.",
    label: "DistrictName", orderBy: "State, DistrictName",
    unique: [["State", "DistrictName"], "This district already exists in this state"],
    fields: [
      { name: "DistrictName", label: "District", type: "text", required: true, max: 100 },
      { name: "DistrictCode", label: "Code", type: "text", max: 20, upper: true },
      { name: "State", label: "State", type: "text", required: true, max: 100, default: "West Bengal" },
      ACTIVE,
    ],
  },
  "sub-division": {
    title: "Sub-Division", group: "Locations", pageKey: "legal-sub-division-master", table: "LegalSubDivision", pk: "SubDivisionId",
    desc: "Sub-divisions of a district.",
    label: "SubDivisionName", orderBy: "DistrictId, SubDivisionName",
    unique: [["DistrictId", "SubDivisionName"], "This sub-division already exists in this district"],
    fields: [
      { name: "DistrictId", label: "District", type: "ref", ref: "district", required: true },
      { name: "SubDivisionName", label: "Sub-division", type: "text", required: true, max: 150 },
      ACTIVE,
    ],
  },
  block: {
    title: "Block", group: "Locations", pageKey: "legal-block-master", table: "LegalBlock", pk: "BlockId",
    desc: "Community development blocks, under a district and sub-division.",
    label: "BlockName", orderBy: "DistrictId, BlockName",
    unique: [["DistrictId", "BlockName"], "This block already exists in this district"],
    fields: [
      { name: "DistrictId", label: "District", type: "ref", ref: "district", required: true },
      { name: "SubDivisionId", label: "Sub-division", type: "ref", ref: "sub-division", filterBy: "DistrictId" },
      { name: "BlockName", label: "Block", type: "text", required: true, max: 150 },
      ACTIVE,
    ],
  },
  "location-type": lookup("location-type", "Land Location Type", "Locations", "Rural, urban, municipal, industrial…"),
  municipality: {
    title: "Municipality", group: "Locations", pageKey: "legal-municipality-master", table: "LegalMunicipality", pk: "MunicipalityId",
    desc: "Municipalities, corporations and panchayats — the local body for building sanction and mutation.",
    label: "BodyName", orderBy: "DistrictId, BodyName",
    unique: [["DistrictId", "BodyName"], "This local body already exists in this district"],
    fields: [
      { name: "DistrictId", label: "District", type: "ref", ref: "district", required: true },
      { name: "BodyName", label: "Name", type: "text", required: true, max: 150 },
      { name: "BodyType", label: "Type", type: "select", required: true, options: ["Municipal Corporation", "Municipality", "Notified Area Authority", "Development Authority", "Gram Panchayat", "Panchayat Samiti"], default: "Municipality" },
      { name: "WardCount", label: "Number of wards", type: "int", min: 1 },
      PHONE,
      { name: "Address", label: "Office address", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },
  "police-station": {
    title: "Police Station", group: "Locations", pageKey: "legal-police-station-master", table: "LegalPoliceStation", pk: "PoliceStationId",
    desc: "Police stations whose jurisdiction a parcel falls under, as written in deeds.",
    label: "StationName", orderBy: "DistrictId, StationName",
    unique: [["DistrictId", "StationName"], "This police station already exists in this district"],
    fields: [
      { name: "DistrictId", label: "District", type: "ref", ref: "district", required: true },
      { name: "StationName", label: "Police station", type: "text", required: true, max: 150 },
      PHONE,
      { name: "Address", label: "Address", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },
  village: {
    title: "Village", group: "Locations", pageKey: "legal-village-master", table: "LegalVillage", pk: "VillageId",
    desc: "Villages / localities, with their police station, local body and revenue Mouza.",
    label: "VillageName", orderBy: "DistrictId, VillageName",
    unique: [["DistrictId", "VillageName"], "This village already exists in this district"],
    fields: [
      { name: "DistrictId", label: "District", type: "ref", ref: "district", required: true },
      { name: "VillageName", label: "Village / locality", type: "text", required: true, max: 150 },
      { name: "PoliceStationId", label: "Police station", type: "ref", ref: "police-station", filterBy: "DistrictId" },
      { name: "MunicipalityId", label: "Municipality / local body", type: "ref", ref: "municipality", filterBy: "DistrictId" },
      { name: "BlockId", label: "Block", type: "ref", ref: "block", filterBy: "DistrictId" },
      { name: "MouzaId", label: "Revenue Mouza", type: "ref", ref: "mouza", filterBy: "DistrictId", blankOk: true },
      { name: "Pincode", label: "Pincode", type: "text", max: 10, pattern: "^[0-9]{6}$", patternMsg: "Pincode must be 6 digits" },
      ACTIVE,
    ],
  },

  // ── Registration ────────────────────────────────────────────────────────────────────────────────
  "registration-office": {
    title: "Deed Registration Office", group: "Registration", pageKey: "legal-registration-office-master", table: "LegalRegistrationOffice", pk: "OfficeId",
    desc: "Government offices where deeds and other registrable documents are registered.",
    label: "OfficeName", orderBy: "District, OfficeName",
    unique: [["OfficeCode"], "This office code already exists"],
    fields: [
      { name: "OfficeCode", label: "Office code", type: "text", required: true, max: 30, upper: true },
      { name: "OfficeName", label: "Official name", type: "text", required: true, max: 200 },
      { name: "OfficeType", label: "Office type", type: "select", required: true, options: ["ADSR", "DSR", "ARA", "Registrar", "Sub-Registrar", "Other"] },
      { name: "State", label: "State", type: "text", required: true, max: 100, default: "West Bengal" },
      { name: "District", label: "District", type: "text", required: true, max: 100 },
      { name: "Jurisdiction", label: "Jurisdiction", type: "textarea", max: 500 },
      { name: "Address", label: "Address", type: "textarea", max: 500 },
      { name: "Phone", label: "Phone", type: "text", max: 30 },
      { name: "Email", label: "Email", type: "text", max: 150, pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", patternMsg: "Enter a valid email" },
      ACTIVE,
    ],
  },
  "portal-link": {
    title: "Official Portal Link", group: "Registration", pageKey: "legal-portal-link-master", table: "LegalPortalLink", pk: "LinkId",
    desc: "Maintained official URLs per office and service. Links not tested for 90 days are flagged.",
    label: "LinkLabel", orderBy: "ServiceType, LinkLabel",
    fields: [
      { name: "OfficeId", label: "Registration office (blank = all)", type: "ref", ref: "registration-office" },
      { name: "ServiceType", label: "Service", type: "select", required: true, options: ["Deed Search", "Certified Copy", "Deed Registration", "Market Value", "Land Record / RoR", "Mutation", "Other"] },
      { name: "LinkLabel", label: "Link label", type: "text", required: true, max: 150 },
      { name: "Url", label: "Official URL", type: "url", required: true, max: 500 },
      { name: "LastTestedDate", label: "Last tested on", type: "date" },
      { name: "VerifiedBy", label: "Verified by", type: "ref", ref: "user" },
      { name: "FallbackInstructions", label: "If the portal is down", type: "textarea", max: 1000 },
      ACTIVE,
    ],
  },
  "deed-type": {
    title: "Deed Type", group: "Registration", pageKey: "legal-deed-type-master", table: "LegalDeedType", pk: "DeedTypeId",
    desc: "Controlled deed categories, so every deed is classified the same way.",
    label: "DeedTypeName", orderBy: "DeedTypeName",
    unique: [["DeedTypeCode"], "This deed type code already exists"],
    fields: [
      { name: "DeedTypeCode", label: "Code", type: "text", required: true, max: 20, upper: true },
      { name: "DeedTypeName", label: "Official / display name", type: "text", required: true, max: 150 },
      { name: "TransactionType", label: "Transaction type", type: "select", required: true, options: ["Purchase", "Sale", "Gift", "Exchange", "Lease", "Mortgage", "Power of Attorney", "Partition", "Development Agreement", "Rectification", "Other"] },
      { name: "Description", label: "Description", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },
  "task-type": {
    title: "Registration Task Type", group: "Registration", pageKey: "legal-task-type-master", table: "LegalTaskType", pk: "TaskTypeId",
    desc: "A registration process: its deed type, document checklist and approval route.",
    label: "TaskTypeName", orderBy: "TaskTypeName",
    unique: [["TaskTypeCode"], "This task type code already exists"],
    fields: [
      { name: "TaskTypeCode", label: "Code", type: "text", required: true, max: 20, upper: true },
      { name: "TaskTypeName", label: "Name", type: "text", required: true, max: 150 },
      { name: "DeedTypeId", label: "Deed type", type: "ref", ref: "deed-type", required: true },
      { name: "ChecklistTemplateId", label: "Default checklist", type: "ref", ref: "checklist-template", required: true, filterBy: "DeedTypeId", blankOk: true, fill: { Jurisdiction: "Jurisdiction" } },
      { name: "WorkflowId", label: "Approval workflow", type: "ref", ref: "approval-workflow", required: true },
      { name: "Jurisdiction", label: "Jurisdiction", type: "text", max: 150 },
      { name: "Description", label: "Description", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },

  // ── Documents ───────────────────────────────────────────────────────────────────────────────────
  "document-type": {
    title: "Legal Document Type", group: "Documents", pageKey: "legal-document-type-master", table: "LegalDocumentType", pk: "DocTypeId",
    desc: "The catalogue of evidence a deed file can hold, with sensitivity and retention.",
    label: "DocTypeName", orderBy: "Category, DocTypeName",
    unique: [["DocTypeCode"], "This document type code already exists"],
    fields: [
      { name: "DocTypeCode", label: "Code", type: "text", required: true, max: 20, upper: true },
      { name: "DocTypeName", label: "Name", type: "text", required: true, max: 150 },
      { name: "Category", label: "Category", type: "select", required: true, options: ["Draft", "Identity", "Tax", "Title", "Land Record", "Revenue", "Payment", "Photograph", "Registration", "Other"] },
      { name: "Sensitivity", label: "Sensitivity", type: "select", required: true, options: ["Internal", "Confidential", "Personal Data"], default: "Internal" },
      { name: "RetentionClass", label: "Retention", type: "select", required: true, options: ["Permanent", "10 Years", "8 Years", "5 Years"], default: "Permanent" },
      { name: "ExpiryDays", label: "Valid for (days, blank = no expiry)", type: "int", min: 1 },
      { name: "Description", label: "Description", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },
  "checklist-template": {
    title: "Document Checklist Template", group: "Documents", pageKey: "legal-checklist-template-master", table: "LegalChecklistTemplate", pk: "TemplateId",
    desc: "Versioned sets of required documents for a deed type. Items are added in Checklist Items.",
    label: "TemplateName + ' v' + CAST(VersionNo AS NVARCHAR(10))", orderBy: "TemplateName, VersionNo DESC",
    unique: [["TemplateName", "VersionNo"], "This template version already exists"],
    fields: [
      { name: "TemplateName", label: "Template name", type: "text", required: true, max: 150 },
      { name: "VersionNo", label: "Version", type: "int", required: true, min: 1, default: 1 },
      { name: "DeedTypeId", label: "Deed type (blank = any)", type: "ref", ref: "deed-type" },
      { name: "Jurisdiction", label: "Jurisdiction", type: "text", max: 150 },
      { name: "EffectiveFrom", label: "Effective from", type: "date", required: true },
      { name: "EffectiveTo", label: "Effective to", type: "date", after: "EffectiveFrom" },
      { name: "ApprovedBy", label: "Approved by (legal / compliance)", type: "ref", ref: "user" },
      { name: "Remarks", label: "Conditions / remarks", type: "textarea", max: 1000 },
      ACTIVE,
    ],
  },
  "checklist-item": {
    title: "Checklist Item", group: "Documents", pageKey: "legal-checklist-item-master", table: "LegalChecklistItem", pk: "ItemId",
    desc: "Each document a template asks for: required or not, the stage it is needed at, N/A and waiver rules.",
    label: "CAST(SortOrder AS NVARCHAR(10))", orderBy: "TemplateId, SortOrder",
    unique: [["TemplateId", "DocTypeId"], "This document is already on this template"],
    fields: [
      { name: "TemplateId", label: "Checklist template", type: "ref", ref: "checklist-template", required: true },
      { name: "DocTypeId", label: "Document type", type: "ref", ref: "document-type", required: true },
      { name: "Requirement", label: "Requirement", type: "select", required: true, options: ["Required", "Conditional", "Optional"], default: "Required" },
      { name: "StageNeeded", label: "Needed by", type: "select", required: true, options: ["Search", "Deed Details", "Before L1", "Before L2", "Closure"], default: "Before L1" },
      { name: "SortOrder", label: "Order", type: "int", required: true, min: 1, default: 1 },
      { name: "ReminderDays", label: "Remind every (days)", type: "int", min: 1 },
      { name: "AllowNA", label: "Can be marked N/A (with reason)", type: "bit", default: true },
      { name: "Waivable", label: "Can be waived by an approver", type: "bit", default: false },
      { name: "Instructions", label: "Instructions", type: "textarea", max: 1000 },
      ACTIVE,
    ],
  },

  // ── Workflow ────────────────────────────────────────────────────────────────────────────────────
  "approval-workflow": {
    title: "Approval Workflow", group: "Workflow", pageKey: "legal-approval-workflow-master", table: "LegalApprovalWorkflow", pk: "WorkflowId",
    desc: "The two-level approval route: who reviews at L1 and L2, their SLAs and escalation.",
    label: "WorkflowName", orderBy: "WorkflowName",
    unique: [["WorkflowName"], "A workflow with this name already exists"],
    fields: [
      { name: "WorkflowName", label: "Workflow name", type: "text", required: true, max: 150 },
      { name: "L1RoleId", label: "L1 reviewer role", type: "ref", ref: "role", required: true },
      { name: "L1SlaDays", label: "L1 SLA (days)", type: "int", required: true, min: 1, default: 2 },
      { name: "L2RoleId", label: "L2 approver role", type: "ref", ref: "role", required: true },
      { name: "L2SlaDays", label: "L2 SLA (days)", type: "int", required: true, min: 1, default: 2 },
      { name: "EscalationRoleId", label: "Escalate to role", type: "ref", ref: "role" },
      { name: "EffectiveFrom", label: "Effective from", type: "date", required: true },
      { name: "EffectiveTo", label: "Effective to", type: "date", after: "EffectiveFrom" },
      { name: "SeparationOfDuties", label: "Creator / uploader cannot approve", type: "bit", default: true },
      { name: "AllowDelegation", label: "Approvers may delegate", type: "bit", default: false },
      ACTIVE,
    ],
  },
  "status-reason": {
    title: "Status & Reason", group: "Workflow", pageKey: "legal-status-reason-master", table: "LegalStatusReason", pk: "ReasonId",
    desc: "Status codes and the reasons used for missing documents, returns, rejections and holds.",
    label: "ReasonLabel", orderBy: "Category, SortOrder, ReasonLabel",
    unique: [["Category", "ReasonCode"], "This code already exists in this category"],
    fields: [
      { name: "Category", label: "Category", type: "select", required: true, options: ["Task Status", "Missing Document", "Return", "Rejection", "Cancellation", "On Hold", "Discrepancy", "Waiver"] },
      { name: "ReasonCode", label: "Code", type: "text", required: true, max: 40, upper: true },
      { name: "ReasonLabel", label: "Label", type: "text", required: true, max: 150 },
      { name: "SortOrder", label: "Order", type: "int", min: 0, default: 0 },
      { name: "Description", label: "Meaning", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },
  "reminder-sla": {
    title: "Reminder & SLA", group: "Workflow", pageKey: "legal-reminder-sla-master", table: "LegalReminderSla", pk: "ReminderId",
    desc: "How often a pending status is followed up and when it escalates, and to whom.",
    label: "AppliesTo", orderBy: "AppliesTo",
    unique: [["AppliesTo"], "A reminder rule for this status already exists"],
    fields: [
      { name: "AppliesTo", label: "Applies to", type: "select", required: true, options: ["Search Pending", "Awaiting Registered Deed", "Pending Documents", "L1 Pending", "L1 Returned", "L2 Pending", "L2 Returned", "On Hold"] },
      { name: "RemindEveryDays", label: "Remind every (days)", type: "int", required: true, min: 1, default: 2 },
      { name: "EscalateAfterDays", label: "Escalate after (days)", type: "int", required: true, min: 1, default: 7 },
      { name: "RecipientRoleId", label: "Remind role (blank = task owner)", type: "ref", ref: "role" },
      { name: "EscalationRoleId", label: "Escalate to role", type: "ref", ref: "role" },
      { name: "WorkingDaysOnly", label: "Count working days only", type: "bit", default: true },
      ACTIVE,
    ],
  },

  // ── Land record, ownership, legal & financial lists ────────────────────────────────────────────
  "copy-type": lookup("copy-type", "Document Copy Type", "Land records", "Certified, online, office copy, photocopy…"),
  "enquiry-source": lookup("enquiry-source", "Enquiry Source", "Land records", "Where a land enquiry came from"),
  "ownership-type": lookup("ownership-type", "Ownership Type", "Ownership", "Individual, joint, inherited, company…"),
  "relationship-type": lookup("relationship-type", "Relationship Type", "Ownership", "Father, son, wife, legal heir…"),
  "transfer-type": lookup("transfer-type", "Ownership Transfer Type", "Ownership", "Sale, inheritance, gift, partition…"),
  "ownership-status": lookup("ownership-status", "Ownership Status", "Ownership", "Current, previous, disputed, pending"),
  "identity-doc-type": lookup("identity-doc-type", "Identity Document Type", "Ownership", "Aadhaar, PAN, voter ID, passport…"),
  "case-type": lookup("case-type", "Legal Case Type", "Legal & Financial", "Civil, land dispute, acquisition…"),
  "mortgage-type": lookup("mortgage-type", "Mortgage Type", "Legal & Financial", "Bank loan, private loan, charge…"),
  "legal-status": lookup("legal-status", "Legal Status", "Legal & Financial", "Open, pending, resolved, appealed…"),
  "txn-type": lookup("txn-type", "Financial Transaction Type", "Legal & Financial", "Advance, purchase payment, refund…"),
  "expense-type": lookup("expense-type", "Expense Type", "Legal & Financial", "Advocate fee, commission, survey fee…"),
  "payment-mode": lookup("payment-mode", "Payment Mode", "Legal & Financial", "Cash, bank transfer, cheque, UPI…"),
  "fee-type": lookup("fee-type", "Registration Fee Type", "Registration", "Stamp duty, registration, scanning fee…"),

  // ── Parties ─────────────────────────────────────────────────────────────────────────────────────
  buyer: person("Buyer", "Buyer", "Buyers of land: identity, PAN / Aadhaar and their land record documents."),
  seller: person("Seller", "Seller", "Sellers of land: identity, PAN / Aadhaar and their title documents."),
  owner: person("Owner", "Owner", "Recorded owners of land parcels, picked on the Land master."),
  customer: person("Customer", "Customer", "Customers a land deal is for, with their identity and documents."),
  witness: person("Witness", "Witness", "Witnesses to deeds, with their identity proof.", { landDocs: false }),
  advocate: {
    title: "Advocate", group: "Parties", pageKey: "legal-advocate-master", table: "LegalAdvocate", pk: "AdvocateId",
    desc: "Advocates and lawyers who draft, vet and register deeds for the company.",
    label: "AdvocateName", orderBy: "AdvocateName",
    unique: [["EnrolmentNo"], "An advocate with this enrolment number already exists"],
    fields: [
      { name: "AdvocateName", label: "Advocate name", type: "text", required: true, max: 200 },
      { name: "EnrolmentNo", label: "Bar enrolment number", type: "text", required: true, max: 40, upper: true },
      { name: "BarCouncil", label: "Bar council", type: "text", required: true, max: 150, default: "Bar Council of West Bengal" },
      { name: "Practice", label: "Practice area", type: "select", options: ["Property / Conveyancing", "Civil", "Revenue / Land Reforms", "Corporate", "Other"], default: "Property / Conveyancing" },
      { name: "CourtOfPractice", label: "Court / office of practice", type: "text", max: 150 },
      PAN,
      PHONE,
      EMAIL,
      { name: "Address", label: "Chamber address", type: "textarea", max: 500 },
      { name: "EnrolmentFileId", label: "Enrolment certificate", type: "file" },
      { name: "FeeTerms", label: "Fee terms", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },
  party: {
    title: "Party", group: "Parties", pageKey: "legal-party-master", table: "LegalParty", pk: "PartyId",
    desc: "Buyers, sellers, POA holders and witnesses, linked to deeds with a role.",
    label: "LegalName", orderBy: "LegalName",
    fields: [
      { name: "PartyType", label: "Party type", type: "select", required: true, options: ["Individual", "Company", "LLP", "Partnership Firm", "Trust", "HUF", "Society", "Government", "Other"], default: "Individual" },
      { name: "LegalName", label: "Name as on records", type: "text", required: true, max: 200 },
      { name: "GuardianName", label: "Father / husband name", type: "text", max: 200 },
      { name: "Pan", label: "PAN", type: "text", max: 10, upper: true, pattern: "^[A-Z]{5}[0-9]{4}[A-Z]$", patternMsg: "PAN must look like ABCDE1234F" },
      { name: "Phone", label: "Phone", type: "text", max: 30 },
      { name: "Email", label: "Email", type: "text", max: 150, pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", patternMsg: "Enter a valid email" },
      { name: "Address", label: "Address", type: "textarea", max: 500 },
      { name: "VerificationStatus", label: "Verification", type: "select", required: true, options: ["Unverified", "Verified", "Rejected"], default: "Unverified" },
      { name: "PrivacyClass", label: "Privacy", type: "select", required: true, options: ["Normal", "Sensitive"], default: "Normal" },
      ACTIVE,
    ],
  },
};

// Pickers backed by core ERP tables rather than a Legal master.
const EXTERNAL_REFS = {
  project: { sql: "SELECT id AS value, name AS label FROM dbo.enterprise WHERE business_type = 'P' ORDER BY name", exists: "SELECT 1 FROM dbo.enterprise WHERE id = @v AND business_type = 'P'" },
  role: { sql: "SELECT RId AS value, RName AS label FROM dbo.Role ORDER BY RName", exists: "SELECT 1 FROM dbo.Role WHERE RId = @v" },
  user: { sql: "SELECT id AS value, name AS label FROM dbo.users ORDER BY name", exists: "SELECT 1 FROM dbo.users WHERE id = @v" },
};

module.exports = { MASTERS, EXTERNAL_REFS };
