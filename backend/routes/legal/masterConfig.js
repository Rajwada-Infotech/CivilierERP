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
//   `review: { field, by, at, free }` — setting `field` outside `free` (default ["Pending"]) needs the approve
//   right and stamps who / when; `requiredWhen: { field, values }` makes a field required for those values;
//   `afterWrite(pool, req, row, before)` runs after a successful add / update (a clearance putting the land on hold).
//   `where` narrows a master with SQL ({t} = the row's table or alias), e.g. lands already acquired;
//   `extras: [{ name, label, sql }]` adds read-only computed columns to the list (alias t is the row);
//   `check(pool, values, id)` returns a message to refuse an add / update on a business rule (id null on add).
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
const MORTGAGE_STATUSES = ["No Mortgage Found", "Mortgage Active", "Loan Outstanding", "Loan Closed", "Release Pending", "Release Verified", "Needs Investigation"];
const VERIFICATION_CHECKS = ["Encumbrance Search", "Court Case Verification", "Land Dispute Verification", "Government Acquisition Check",
  "Land Classification Verification", "Boundary Verification", "Co-owner Consent Verification", "Title Search", "Ownership Chain Verification"];
const DUE_DILIGENCE_CHECKS = ["Title Search", "Ownership Chain", "Previous Deed Verification", "Current Owner Verification", "Encumbrance Search",
  "Court Case Verification", "Mortgage Verification", "Government Acquisition Check", "Land Classification Verification", "Boundary Verification",
  "Co-owner Consent", "RS/LR Record Mapping"];
const DEED_STATUSES = ["Not Started", "Drafting", "Draft Under Review", "Awaiting Payment", "Payment Completed", "Appointment Scheduled", "Submitted",
  "Registration Pending", "Correction Required", "Successfully Registered", "Registered Deed Awaiting", "Completed"];
const DRAFT_CHECKS = ["Buyer details correct", "Seller details correct", "Ownership shares correct", "Land area correct", "Mouza and JL Number correct",
  "RS Khatian and Dag correct", "LR Khatian and Dag correct", "Boundary details correct", "Consideration amount correct", "Deed type correct",
  "Registration office correct", "Required attachments available"];
const MUTATION_STATUSES = ["Not Applied", "Draft", "Submitted", "Under Process", "Hearing Scheduled", "Objection Raised", "Correction Required", "Approved", "Rejected"];
const FINAL_CHECKS = ["Registered deed uploaded and approved", "Ownership transfer recorded", "Mutation application status recorded",
  "New Khatian / RoR uploaded where applicable", "Identity and ownership documents verified", "Legal documents verified",
  "Purchase / sale financial records reconciled", "Outstanding blocking issues resolved", "Final checklist completed"];
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
    // Read-only: the land properties whose RS / LR records use this entry.
    extras: [{ name: "UsedByLands", label: "Used by land", sql: "(SELECT STRING_AGG(l.LandCode, ', ') FROM (SELECT DISTINCT x.LandId FROM dbo.LegalLandRsRecord x WHERE x.RsKhatianId = t.RsKhatianId AND x.IsActive = 1) u JOIN dbo.LegalLand l ON l.LandId = u.LandId)" }],
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
    // Read-only: the land properties whose RS / LR records use this entry.
    extras: [{ name: "UsedByLands", label: "Used by land", sql: "(SELECT STRING_AGG(l.LandCode, ', ') FROM (SELECT DISTINCT x.LandId FROM dbo.LegalLandRsRecord x WHERE x.RsPlotId = t.RsPlotId AND x.IsActive = 1) u JOIN dbo.LegalLand l ON l.LandId = u.LandId)" }],
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
    // Read-only: the land properties whose RS / LR records use this entry.
    extras: [{ name: "UsedByLands", label: "Used by land", sql: "(SELECT STRING_AGG(l.LandCode, ', ') FROM (SELECT DISTINCT x.LandId FROM dbo.LegalLandLrRecord x WHERE x.LrRorId = t.LrRorId AND x.IsActive = 1) u JOIN dbo.LegalLand l ON l.LandId = u.LandId)" }],
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
  "land-photo": landChild("Land Photo", "LegalLandPhoto", "PhotoId", "Photographs of the land property — as many as needed.", {
    label: "r.Caption", orderBy: "TakenOn, PhotoId",
    fields: [
      LAND_ID,
      { name: "Caption", label: "Caption", type: "text", required: true, max: 200 },
      { name: "PhotoFileId", label: "Photo", type: "file", required: true },
      { name: "TakenOn", label: "Taken on", type: "date" },
      { name: "Remarks", label: "Remarks", type: "textarea", max: 500 },
      ACTIVE,
    ],
  }),
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
      // Optional links to the registers: picking one fills the numbers, holder and area below.
      { name: "RsKhatianId", label: "Pick RS Khatian from register (optional)", type: "ref", ref: "rs-khatian", filterBy: "MouzaId", fill: { RsKhatianNo: "KhatianNo", RecordedHolder: "HolderName", Share: "Share" } },
      { name: "RsPlotId", label: "Pick RS plot from register (optional)", type: "ref", ref: "rs-plot", filterBy: "MouzaId", fill: { RsDagNo: "PlotNo", Area: "Area", AreaUnitId: "AreaUnitId", RsKhatianId: "RsKhatianId" } },
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
      { name: "LrRorId", label: "Pick LR RoR from register (optional)", type: "ref", ref: "lr-ror", filterBy: "MouzaId", fill: { LrKhatianNo: "LrKhatianNo", LrDagNo: "LrPlotNo", RecordedHolder: "HolderName", GuardianName: "GuardianName", Area: "Area", AreaUnitId: "AreaUnitId", Share: "Share", RorDate: "RorDate" } },
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
      label: "CONVERT(NVARCHAR(10), r.EventDate, 105) + ' ' + ISNULL((SELECT x.Name FROM dbo.LegalLookupValue x WHERE x.LookupId = r.TransferTypeId), '') + ': ' + ISNULL(r.PreviousOwnerName, '?') + N' → ' + r.NewOwnerName",
      orderBy: "EventDate, EventId", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "TransferTypeId", label: "Transfer type", type: "ref", ref: "transfer-type", required: true },
        { name: "EventDate", label: "Transfer date", type: "date", required: true },
        // Earlier owners are history, typed in by name; linking a Party master entry is optional and fills the name.
        { name: "PreviousOwnerName", label: "From — previous owner name", type: "text", max: 200 },
        { name: "PreviousOwnerGuardian", label: "Previous owner's father / husband", type: "text", max: 200 },
        { name: "PreviousOwnerId", label: "Previous owner in Party master (optional)", type: "ref", ref: "person", fill: { PreviousOwnerName: "FullName", PreviousOwnerGuardian: "GuardianName" } },
        { name: "NewOwnerName", label: "To — new owner name", type: "text", required: true, max: 200 },
        { name: "NewOwnerGuardian", label: "New owner's father / husband", type: "text", max: 200 },
        { name: "NewOwnerId", label: "New owner in Party master (optional)", type: "ref", ref: "person", fill: { NewOwnerName: "FullName", NewOwnerGuardian: "GuardianName" } },
        { name: "DocTypeId", label: "Transfer document type", type: "ref", ref: "document-type" },
        { name: "DocumentNo", label: "Document number", type: "text", max: 100 },
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
      label: "r.OwnerName + ' ' + CAST(CAST(r.SharePct AS DECIMAL(7,2)) AS NVARCHAR(10)) + '% from ' + CONVERT(NVARCHAR(10), r.ValidFrom, 105)",
      orderBy: "ValidFrom, RecordId", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "OwnerName", label: "Owner name", type: "text", required: true, max: 200 },
        { name: "OwnerGuardian", label: "Father / husband name", type: "text", max: 200 },
        { name: "PersonId", label: "Owner in Party master (optional)", type: "ref", ref: "person", fill: { OwnerName: "FullName", OwnerGuardian: "GuardianName" } },
        { name: "OwnershipTypeId", label: "Ownership type", type: "ref", ref: "ownership-type", required: true },
        { name: "RelationshipTypeId", label: "Relationship", type: "ref", ref: "relationship-type" },
        { name: "SharePct", label: "Ownership share (%)", type: "decimal", required: true, maxValue: 100 },
        { name: "ValidFrom", label: "Ownership start date", type: "date", required: true },
        { name: "ValidTo", label: "Ownership end date (blank = current)", type: "date", after: "ValidFrom" },
        { name: "EventId", label: "Created by transfer", type: "ref", ref: "ownership-event", filterBy: "LandId" },
        { name: "PreviousOwnerName", label: "Previous owner name", type: "text", max: 200 },
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
      label: "'Estate of ' + r.DeceasedName",
      orderBy: "InheritanceId", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "DeceasedName", label: "Deceased owner name", type: "text", required: true, max: 200 },
        { name: "DeceasedGuardian", label: "Deceased's father / husband", type: "text", max: 200 },
        { name: "DeceasedPersonId", label: "Deceased in Party master (optional)", type: "ref", ref: "person", fill: { DeceasedName: "FullName", DeceasedGuardian: "GuardianName" } },
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
      label: "r.HeirName", orderBy: "InheritanceId, HeirId",
      unique: [["InheritanceId", "HeirName"], "This heir is already listed for this inheritance"],
      fields: [
        LAND_ID,
        { name: "InheritanceId", label: "Inheritance", type: "ref", ref: "inheritance", filterBy: "LandId", required: true },
        { name: "HeirName", label: "Legal heir name", type: "text", required: true, max: 200 },
        { name: "HeirGuardian", label: "Heir's father / husband", type: "text", max: 200 },
        { name: "PersonId", label: "Heir in Party master (optional)", type: "ref", ref: "person", fill: { HeirName: "FullName", HeirGuardian: "GuardianName" } },
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

  // ── Phase 3: legal verification ──
  "legal-case": landChild("Court Case", "LegalCase", "CaseId",
    "Court cases and disputes touching this land: parties, court, status, next hearing and result.", {
      label: "r.CaseNumber + ' - ' + r.CourtName", orderBy: "FilingDate, CaseId", review: REVIEW,
      unique: [["LandId", "CaseNumber"], "This case number is already recorded for this land"],
      fields: [
        LAND_ID,
        { name: "CaseNumber", label: "Case number", type: "text", required: true, max: 80, upper: true },
        { name: "CaseTypeId", label: "Case type", type: "ref", ref: "case-type", required: true },
        { name: "CourtName", label: "Court", type: "text", required: true, max: 200 },
        { name: "FilingDate", label: "Filing date", type: "date" },
        { name: "Plaintiff", label: "Plaintiff", type: "text", max: 500 },
        { name: "Defendant", label: "Defendant", type: "text", max: 500 },
        { name: "CaseSubject", label: "Case subject", type: "textarea", required: true, max: 1000 },
        { name: "AdvocateId", label: "Advocate", type: "ref", ref: "advocate" },
        { name: "LegalStatusId", label: "Case status", type: "ref", ref: "legal-status", required: true },
        { name: "NextHearingDate", label: "Next hearing date", type: "date" },
        { name: "CaseResult", label: "Case result", type: "textarea", max: 1000 },
        { name: "DocFileId", label: "Case documents", type: "file" },
        VERIFICATION,
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "case-hearing": landChild("Hearing", "LegalCaseHearing", "HearingId",
    "The hearing history of each court case.", {
      label: "CONVERT(NVARCHAR(10), r.HearingDate, 105)", orderBy: "CaseId, HearingDate",
      fields: [
        LAND_ID,
        { name: "CaseId", label: "Court case", type: "ref", ref: "legal-case", filterBy: "LandId", required: true },
        { name: "HearingDate", label: "Hearing date", type: "date", required: true },
        { name: "Purpose", label: "Purpose", type: "text", max: 300 },
        { name: "Outcome", label: "Outcome", type: "textarea", max: 1000 },
        { name: "NextDate", label: "Next date", type: "date", after: "HearingDate" },
        { name: "DocFileId", label: "Order / record", type: "file" },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 500 },
        ACTIVE,
      ],
    }),
  mortgage: landChild("Mortgage & Loan", "LegalMortgage", "MortgageId",
    "Mortgages, loans and charges on this land, and their release.", {
      label: "r.LenderName + ' - ' + r.MortgageStatus", orderBy: "LoanStartDate, MortgageId", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "LenderName", label: "Lender", type: "text", required: true, max: 200 },
        { name: "BorrowerName", label: "Borrower", type: "text", max: 200 },
        { name: "MortgageTypeId", label: "Mortgage type", type: "ref", ref: "mortgage-type", required: true },
        { name: "LoanAccountRef", label: "Loan account reference", type: "text", max: 80 },
        { name: "LoanAmount", label: "Loan amount (₹)", type: "decimal" },
        { name: "OutstandingAmount", label: "Outstanding amount (₹)", type: "decimal" },
        { name: "LoanStartDate", label: "Loan start date", type: "date" },
        { name: "LoanEndDate", label: "Loan end date", type: "date", after: "LoanStartDate" },
        { name: "RegistrationDetails", label: "Mortgage registration details", type: "text", max: 500 },
        { name: "ChargeDetails", label: "Security / charge details", type: "text", max: 500 },
        { name: "ReleaseDocFileId", label: "NOC / release document", type: "file" },
        { name: "ClearanceDate", label: "Clearance date", type: "date" },
        { name: "MortgageStatus", label: "Mortgage status", type: "select", required: true, options: MORTGAGE_STATUSES, default: "Needs Investigation" },
        VERIFICATION,
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "verification-check": landChild("Legal Verification Check", "LegalVerificationCheck", "CheckId",
    "Encumbrance, title, acquisition, boundary and other searches. \"Not Found\" is a result; \"Not Checked\" and \"Search Failed\" are not.", {
      label: "r.CheckType + ' - ' + r.Result", orderBy: "CheckType, SearchDate", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "CheckType", label: "Verification type", type: "select", required: true, options: VERIFICATION_CHECKS },
        { name: "SearchDate", label: "Search / verification date", type: "date" },
        { name: "PeriodFrom", label: "Search period from", type: "date" },
        { name: "PeriodTo", label: "Search period to", type: "date", after: "PeriodFrom" },
        { name: "SearchSource", label: "Search source", type: "text", max: 300 },
        { name: "Result", label: "Result", type: "select", required: true, options: ["Not Checked", "Not Found", "Found - Clear", "Found - Issue", "Search Failed"], default: "Not Checked" },
        { name: "DocFileId", label: "Supporting document", type: "file" },
        VERIFICATION,
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "due-diligence": landChild("Due Diligence Check", "LegalDueDiligence", "DiligenceId",
    "The legal executive's / advocate's result for each due diligence check.", {
      label: "r.CheckItem + ' - ' + r.Result", orderBy: "DiligenceId",
      unique: [["LandId", "CheckItem"], "This check is already on the list for this land"],
      review: { field: "Result", by: "ReviewedBy", at: "ReviewedAt" },
      fields: [
        LAND_ID,
        { name: "CheckItem", label: "Check", type: "select", required: true, options: DUE_DILIGENCE_CHECKS },
        { name: "Result", label: "Result", type: "select", required: true, options: ["Pending", "Clear", "Issue Found"], default: "Pending" },
        { name: "Findings", label: "Findings", type: "textarea", max: 1000, requiredWhen: { field: "Result", values: ["Issue Found"] } },
        { name: "DocFileId", label: "Supporting document", type: "file" },
        ACTIVE,
      ],
    }),
  "advocate-assignment": landChild("Advocate Assignment", "LegalAdvocateAssignment", "AssignmentId",
    "Advocates assigned to this land, for what and by when.", {
      label: "(SELECT a.AdvocateName FROM dbo.LegalAdvocate a WHERE a.AdvocateId = r.AdvocateId) + ' - ' + r.Purpose", orderBy: "AssignedDate",
      fields: [
        LAND_ID,
        { name: "AdvocateId", label: "Advocate", type: "ref", ref: "advocate", required: true },
        { name: "Purpose", label: "Purpose", type: "select", required: true, options: ["Title Verification", "Legal Opinion", "Due Diligence", "Court Case", "Deed Review", "Other"], default: "Legal Opinion" },
        { name: "AssignedDate", label: "Assigned date", type: "date", required: true, default: "today" },
        { name: "DueDate", label: "Due date", type: "date", after: "AssignedDate" },
        { name: "AssignmentStatus", label: "Status", type: "select", required: true, options: ["Assigned", "In Progress", "Completed", "Withdrawn"], default: "Assigned" },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "legal-opinion": landChild("Legal Opinion", "LegalOpinion", "OpinionId",
    "The advocate's opinion on title. The system never declares a title valid — an authorised reviewer approves the opinion.", {
      label: "r.OpinionNo + ' - ' + r.FinalOpinion + ' (' + r.OpinionStatus + ')'", orderBy: "OpinionDate, OpinionId",
      unique: [["OpinionNo"], "This opinion number already exists"],
      review: { field: "OpinionStatus", by: "ApprovedBy", at: "ApprovedAt", free: ["Draft", "Under Review"] },
      fields: [
        LAND_ID,
        { name: "OpinionNo", label: "Opinion number", type: "text", max: 30, auto: "OPN" },
        { name: "AdvocateId", label: "Advocate", type: "ref", ref: "advocate", required: true },
        { name: "OpinionDate", label: "Opinion date", type: "date", required: true, default: "today" },
        { name: "ReviewedFrom", label: "Reviewed period from", type: "date" },
        { name: "ReviewedTo", label: "Reviewed period to", type: "date", after: "ReviewedFrom" },
        { name: "Findings", label: "Findings", type: "textarea", required: true, max: 2000 },
        { name: "IdentifiedRisks", label: "Identified risks", type: "textarea", max: 2000 },
        { name: "MissingDocuments", label: "Missing documents", type: "textarea", max: 1000 },
        { name: "Recommendations", label: "Recommendations", type: "textarea", max: 2000 },
        { name: "FinalOpinion", label: "Final opinion", type: "select", required: true, options: ["Title Clear", "Clear with Conditions", "Title Defective", "Further Verification Required"] },
        { name: "Conditions", label: "Conditions", type: "textarea", max: 2000, requiredWhen: { field: "FinalOpinion", values: ["Clear with Conditions"] } },
        { name: "DocFileId", label: "Signed opinion", type: "file" },
        { name: "SignatureRef", label: "Advocate signature / approval reference", type: "text", max: 100 },
        { name: "OpinionStatus", label: "Opinion status", type: "select", required: true, options: ["Draft", "Under Review", "Approved", "Rejected", "Revised"], default: "Draft" },
        ACTIVE,
      ],
    }),
  "legal-clearance": landChild("Legal Clearance", "LegalClearance", "ClearanceId",
    "The clearance decision on an approved opinion. Not Cleared or On Hold puts the land on hold.", {
      label: "r.ClearanceNo + ' - ' + r.Decision", orderBy: "ClearanceId",
      unique: [["ClearanceNo"], "This clearance number already exists"],
      review: { field: "Decision", by: "DecidedBy", at: "DecidedAt", free: ["Pending Decision"] },
      // Not Cleared → legal hold; On Hold → management hold. The land keeps every record while it waits.
      afterWrite: async (pool, req, row, before) => {
        const hold = { "Not Cleared": "Legal Dispute", "On Hold": "Management Decision" }[row.Decision];
        if (!hold || before?.Decision === row.Decision || !row.IsActive) return;
        const r = await pool.request().input("Land", row.LandId).input("Cat", hold).input("UserId", req.user?.userId || null)
          .input("Reason", `Legal clearance ${row.ClearanceNo}: ${row.Decision}${row.BlockingIssues ? ` — ${row.BlockingIssues}` : ""}`.slice(0, 1000))
          .query(`
            UPDATE dbo.LegalLand SET IsOnHold = 1, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Land AND IsOnHold = 0;
            IF @@ROWCOUNT = 1
              INSERT INTO dbo.LegalHold (LandId, HoldCategory, HoldReason, HoldDate, HeldBy)
              OUTPUT INSERTED.HoldId AS id
              VALUES (@Land, @Cat, @Reason, CAST(SYSDATETIME() AS DATE), @UserId);`);
        if (r.recordset?.length) {
          await require("./legalAudit").writeAudit(pool, req, { action: "Land put on hold", entityType: "Land Property", entityId: row.LandId, landId: row.LandId, newValue: { category: hold }, remarks: `From legal clearance ${row.ClearanceNo}` });
        }
      },
      fields: [
        LAND_ID,
        { name: "ClearanceNo", label: "Clearance number", type: "text", max: 30, auto: "CLR" },
        { name: "OpinionId", label: "Legal opinion", type: "ref", ref: "legal-opinion", filterBy: "LandId", required: true },
        { name: "Decision", label: "Decision", type: "select", required: true, options: ["Pending Decision", "Cleared", "Cleared with Conditions", "Not Cleared", "On Hold", "Further Verification Required"], default: "Pending Decision" },
        { name: "Conditions", label: "Conditions", type: "textarea", max: 2000, requiredWhen: { field: "Decision", values: ["Cleared with Conditions"] } },
        { name: "ConditionsMet", label: "All mandatory conditions met / approved", type: "bit", default: false },
        { name: "BlockingIssues", label: "Blocking issues", type: "textarea", max: 2000, requiredWhen: { field: "Decision", values: ["Not Cleared", "Further Verification Required"] } },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),

  // ── Phase 4: purchase & sale ──
  "land-transaction": landChild("Purchase / Sale", "LegalLandTransaction", "TransactionId",
    "Purchase and sale transactions of this land. Expenses never change the land value; the balance is value minus verified payments.", {
      label: "r.TransactionNo + ' - ' + r.TxnType + ' - ' + r.BuyerName", orderBy: "TransactionId",
      unique: [["TransactionNo"], "This transaction number already exists"],
      // The same area cannot be sold twice: live sales (not cancelled) may not exceed the land's area.
      check: async (pool, values, id) => {
        if (values.TxnType !== "Sale" || values.TxnStatus === "Cancelled") return null;
        const r = (await pool.request().input("Land", values.LandId).input("Id", id || 0).input("Area", values.TxnArea).input("Unit", values.AreaUnitId).query(`
          SELECT l.Area * lu.SqFtFactor AS landSqft,
                 ISNULL((SELECT SUM(t.TxnArea * tu.SqFtFactor) FROM dbo.LegalLandTransaction t JOIN dbo.LegalAreaUnit tu ON tu.AreaUnitId = t.AreaUnitId
                          WHERE t.LandId = @Land AND t.TxnType = N'Sale' AND t.TxnStatus <> N'Cancelled' AND t.IsActive = 1 AND t.TransactionId <> @Id), 0) AS soldSqft,
                 @Area * (SELECT SqFtFactor FROM dbo.LegalAreaUnit WHERE AreaUnitId = @Unit) AS thisSqft
          FROM dbo.LegalLand l LEFT JOIN dbo.LegalAreaUnit lu ON lu.AreaUnitId = l.AreaUnitId WHERE l.LandId = @Land`)).recordset[0];
        if (!r?.landSqft) return null;
        const left = r.landSqft - r.soldSqft;
        return r.thisSqft > left + 0.01 ? `Only ${Math.max(left, 0).toFixed(0)} sq ft of this land is still unsold; the same area cannot be sold twice` : null;
      },
      fields: [
        LAND_ID,
        { name: "TransactionNo", label: "Transaction number", type: "text", max: 30, auto: "TXN" },
        { name: "TxnType", label: "Purchase or sale", type: "select", required: true, options: ["Purchase", "Sale"], default: "Purchase" },
        { name: "BuyerName", label: "Buyer / company", type: "text", required: true, max: 200 },
        { name: "BuyerId", label: "Buyer in Party master (optional)", type: "ref", ref: "person", fill: { BuyerName: "FullName" } },
        { name: "SellerNames", label: "Seller(s)", type: "text", required: true, max: 500 },
        { name: "TxnArea", label: "Area (selling / buying)", type: "decimal", required: true, min: 0.000001 },
        { name: "AreaUnitId", label: "Area unit", type: "ref", ref: "area-unit", required: true },
        { name: "RatePerUnit", label: "Rate per unit (₹)", type: "decimal" },
        { name: "TotalValue", label: "Total land value (₹)", type: "decimal", required: true, min: 0.01 },
        { name: "AdvanceAmount", label: "Advance amount (₹)", type: "decimal" },
        { name: "AgreementDate", label: "Agreement date", type: "date" },
        { name: "ExpectedRegistrationDate", label: "Expected registration date", type: "date" },
        { name: "PaymentTerms", label: "Payment terms", type: "textarea", max: 1000 },
        { name: "BrokerName", label: "Broker", type: "text", max: 200 },
        { name: "BrokerCommission", label: "Broker commission (₹)", type: "decimal" },
        { name: "AdvocateFees", label: "Advocate fees (₹)", type: "decimal" },
        { name: "OtherExpenses", label: "Other expenses (₹)", type: "decimal" },
        { name: "AgreementFileId", label: "Agreement document", type: "file" },
        { name: "TxnStatus", label: "Status", type: "select", required: true, options: ["Draft", "Negotiation", "Agreement Signed", "Payment in Progress", "Registered", "Completed", "Cancelled"], default: "Draft" },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  payment: landChild("Payment", "LegalPayment", "PaymentId",
    "Each payment or receipt on its own record, verified separately. Editing a verified payment sends it back for verification.", {
      label: "CONVERT(NVARCHAR(10), r.PaymentDate, 105) + ' ₹' + CONVERT(NVARCHAR(30), r.Amount)", orderBy: "PaymentDate, PaymentId", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "TransactionId", label: "Purchase / sale", type: "ref", ref: "land-transaction", filterBy: "LandId", required: true },
        { name: "PaymentDate", label: "Payment date", type: "date", required: true, default: "today" },
        { name: "TxnTypeId", label: "Payment purpose", type: "ref", ref: "txn-type", required: true },
        { name: "Amount", label: "Amount (₹)", type: "decimal", required: true, min: 0.01 },
        { name: "PaymentModeId", label: "Payment mode", type: "ref", ref: "payment-mode", required: true },
        { name: "Payer", label: "Payer", type: "text", max: 200 },
        { name: "Payee", label: "Payee", type: "text", max: 200 },
        { name: "BankRef", label: "Bank / account reference", type: "text", max: 100 },
        { name: "TransactionRef", label: "Transaction ID / cheque no.", type: "text", max: 100 },
        { name: "ReceiptNo", label: "Receipt number", type: "text", max: 60 },
        { name: "ReceiptFileId", label: "Receipt", type: "file" },
        VERIFICATION,
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  expense: landChild("Expense", "LegalExpense", "ExpenseId",
    "Broker, advocate, survey and government expenses — tracked apart from the land value.", {
      label: "CONVERT(NVARCHAR(10), r.ExpenseDate, 105) + ' ₹' + CONVERT(NVARCHAR(30), r.Amount)", orderBy: "ExpenseDate",
      fields: [
        LAND_ID,
        { name: "TransactionId", label: "Purchase / sale", type: "ref", ref: "land-transaction", filterBy: "LandId" },
        { name: "ExpenseTypeId", label: "Expense type", type: "ref", ref: "expense-type", required: true },
        { name: "ExpenseDate", label: "Date", type: "date", required: true, default: "today" },
        { name: "Amount", label: "Amount (₹)", type: "decimal", required: true, min: 0.01 },
        { name: "PaidTo", label: "Paid to", type: "text", max: 200 },
        { name: "PaymentModeId", label: "Payment mode", type: "ref", ref: "payment-mode" },
        { name: "ReceiptFileId", label: "Receipt", type: "file" },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  valuation: landChild("Valuation & Survey", "LegalValuation", "ValuationId",
    "Market and government valuation, from a stated source (never an assumed fixed rate), and the survey findings.", {
      label: "CONVERT(NVARCHAR(10), r.ValuationDate, 105) + ' - ' + r.ValuationSource", orderBy: "ValuationDate", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "ValuationDate", label: "Valuation date", type: "date", required: true },
        { name: "LandArea", label: "Land area", type: "decimal" },
        { name: "AreaUnitId", label: "Area unit", type: "ref", ref: "area-unit", requiredWith: "LandArea" },
        { name: "MarketRate", label: "Market rate per unit (₹)", type: "decimal" },
        { name: "EstimatedMarketValue", label: "Estimated market value (₹)", type: "decimal" },
        { name: "GovernmentValuation", label: "Government valuation (₹)", type: "decimal" },
        { name: "ValuationSource", label: "Valuation source", type: "text", required: true, max: 300 },
        { name: "ValuationFileId", label: "Valuation report", type: "file" },
        { name: "Surveyor", label: "Surveyor", type: "text", max: 200 },
        { name: "SurveyDate", label: "Survey date", type: "date" },
        { name: "SurveyFileId", label: "Survey report", type: "file" },
        { name: "GpsLatitude", label: "GPS latitude", type: "decimal", signed: true, min: -90, maxValue: 90 },
        { name: "GpsLongitude", label: "GPS longitude", type: "decimal", signed: true, min: -180, maxValue: 180 },
        { name: "BoundaryFindings", label: "Boundary findings", type: "textarea", max: 1000 },
        VERIFICATION,
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  agreement: landChild("Agreement", "LegalAgreement", "AgreementId",
    "The purchase / sale agreement. Signed, Cancelled and Expired are set by a reviewer.", {
      label: "r.AgreementNo + ' - ' + r.AgreementStatus", orderBy: "AgreementDate, AgreementId",
      unique: [["AgreementNo"], "This agreement number already exists"],
      review: { field: "AgreementStatus", by: "ApprovedBy", at: "ApprovedAt", free: ["Draft", "Under Review", "Awaiting Signature"] },
      check: async (_pool, values) =>
        values.AgreementStatus === "Signed" && (values.BuyerSignature !== "Signed" || values.SellerSignature !== "Signed")
          ? "An agreement is Signed only when both the buyer's and the seller's signatures are Signed" : null,
      fields: [
        LAND_ID,
        { name: "AgreementNo", label: "Agreement number", type: "text", max: 30, auto: "AGR" },
        { name: "TransactionId", label: "Purchase / sale", type: "ref", ref: "land-transaction", filterBy: "LandId", required: true, fill: { TotalValue: "TotalValue", AdvanceAmount: "AdvanceAmount", AgreedArea: "TxnArea", AreaUnitId: "AreaUnitId", AgreedRate: "RatePerUnit" } },
        { name: "AgreementType", label: "Agreement type", type: "select", required: true, options: ["Agreement for Sale", "Purchase Agreement", "MoU", "Other"], default: "Agreement for Sale" },
        { name: "AgreedArea", label: "Agreed area", type: "decimal" },
        { name: "AreaUnitId", label: "Area unit", type: "ref", ref: "area-unit", requiredWith: "AgreedArea" },
        { name: "AgreedRate", label: "Agreed rate (₹)", type: "decimal" },
        { name: "TotalValue", label: "Total agreement value (₹)", type: "decimal", required: true, min: 0.01 },
        { name: "AdvanceAmount", label: "Advance amount (₹)", type: "decimal" },
        { name: "PaymentSchedule", label: "Payment schedule", type: "textarea", max: 1000 },
        { name: "AgreementDate", label: "Agreement date", type: "date", required: true },
        { name: "ExpectedRegistrationDate", label: "Expected registration date", type: "date", after: "AgreementDate" },
        { name: "ExpiryDate", label: "Agreement expiry date", type: "date", after: "AgreementDate" },
        { name: "Terms", label: "Terms & conditions", type: "textarea", max: 2000 },
        { name: "BrokerDetails", label: "Broker details", type: "text", max: 300 },
        { name: "AdvocateId", label: "Advocate", type: "ref", ref: "advocate" },
        { name: "AgreementFileId", label: "Agreement document", type: "file" },
        { name: "BuyerSignature", label: "Buyer signature", type: "select", required: true, options: ["Pending", "Signed"], default: "Pending" },
        { name: "SellerSignature", label: "Seller signature", type: "select", required: true, options: ["Pending", "Signed"], default: "Pending" },
        { name: "AgreementStatus", label: "Agreement status", type: "select", required: true, options: ["Draft", "Under Review", "Awaiting Signature", "Signed", "Cancelled", "Expired"], default: "Draft" },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "party-approval": landChild("Buyer & Seller Approval", "LegalPartyApproval", "ApprovalId",
    "Each buyer, seller and co-owner's consent to the agreement, listed separately.", {
      label: "r.PartyName + ' (' + r.PartyRole + ') - ' + r.ConsentStatus", orderBy: "AgreementId, PartyRole",
      unique: [["AgreementId", "PartyName", "PartyRole"], "This party is already listed on this agreement in this role"],
      review: { field: "ConsentStatus", by: "RecordedBy", at: "RecordedAt", free: ["Pending", "Signature Pending"] },
      fields: [
        LAND_ID,
        { name: "AgreementId", label: "Agreement", type: "ref", ref: "agreement", filterBy: "LandId", required: true },
        { name: "PartyName", label: "Party name", type: "text", required: true, max: 200 },
        { name: "PersonId", label: "Party in Party master (optional)", type: "ref", ref: "person", fill: { PartyName: "FullName" } },
        { name: "PartyRole", label: "Role", type: "select", required: true, options: ["Buyer", "Seller", "Co-owner", "Legal Heir", "Authorized Signatory"] },
        { name: "OwnershipSharePct", label: "Ownership share (%)", type: "decimal", maxValue: 100 },
        { name: "ConsentStatus", label: "Consent", type: "select", required: true, options: ["Pending", "Approved", "Rejected", "Signature Pending", "Not Applicable"], default: "Pending" },
        { name: "ApprovalDate", label: "Approval date", type: "date" },
        { name: "SignatureFileId", label: "Signature / consent document", type: "file" },
        { name: "IdVerification", label: "Identity verification", type: "select", required: true, options: ["Pending", "Verified", "Not Verified"], default: "Pending" },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),

  // ── Phase 5: deed & registration ──
  "land-deed": landChild("Deed", "LegalLandDeed", "DeedId",
    "The deed for this land: type, consideration, writer, advocate and registration office. It is marked registered only from a successful registration.", {
      label: "r.DeedCode + ' - ' + r.RegistrationStatus", orderBy: "DeedId",
      unique: [["DeedCode"], "This deed code already exists"],
      check: async (pool, values, id) => {
        if (!["Successfully Registered", "Registered Deed Awaiting", "Completed"].includes(values.RegistrationStatus)) return null;
        if (!id) return "A new deed cannot start as registered";
        const ok = (await pool.request().input("Id", id).query("SELECT TOP 1 1 AS ok FROM dbo.LegalRegAttempt WHERE DeedId = @Id AND Result = N'Successful' AND IsActive = 1")).recordset[0];
        return ok ? null : "Record a successful registration attempt before marking the deed registered";
      },
      fields: [
        LAND_ID,
        { name: "DeedCode", label: "Deed ID", type: "text", max: 30, auto: "DEED" },
        { name: "TransactionId", label: "Purchase / sale", type: "ref", ref: "land-transaction", filterBy: "LandId", fill: { ConsiderationAmount: "TotalValue" } },
        { name: "DeedTypeId", label: "Deed type", type: "ref", ref: "deed-type", required: true },
        { name: "ConsiderationAmount", label: "Consideration amount (₹)", type: "decimal", required: true, min: 0.01 },
        { name: "LandDescription", label: "Land description (schedule)", type: "textarea", max: 2000 },
        { name: "DeedWriter", label: "Deed writer", type: "text", max: 200 },
        { name: "DeedWriterDueDate", label: "Draft expected by", type: "date" },
        { name: "AdvocateId", label: "Reviewing advocate", type: "ref", ref: "advocate" },
        { name: "RegistrationOfficeId", label: "Registration office", type: "ref", ref: "registration-office", required: true },
        { name: "RegisteredDeedNo", label: "Registered deed number", type: "text", max: 60 },
        { name: "RegistrationStatus", label: "Registration status", type: "select", required: true, options: DEED_STATUSES, default: "Not Started" },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "deed-draft": landChild("Deed Draft", "LegalDeedDraft", "DraftId",
    "Every draft version is kept. A correction is a new version; each version gets its own 12-point check.", {
      label: "'Draft v' + CAST(r.VersionNo AS NVARCHAR(10)) + ' - ' + r.ReviewStatus", orderBy: "DeedId, VersionNo",
      unique: [["DeedId", "VersionNo"], "This draft version already exists for this deed"],
      review: { field: "ReviewStatus", by: "ReviewedBy", at: "ReviewedAt" },
      check: async (pool, values, id) => {
        if (values.ReviewStatus !== "Approved") return null;
        if (!id) return "Check the draft before approving it";
        const r = (await pool.request().input("Id", id).query(`SELECT COUNT(*) AS n, SUM(CASE WHEN Result IN (N'Correct', N'Not Applicable') THEN 1 ELSE 0 END) AS ok FROM dbo.LegalDeedDraftCheck WHERE DraftId = @Id AND IsActive = 1`)).recordset[0];
        return r.n < DRAFT_CHECKS.length || r.ok < r.n ? "Every draft check must be Correct or Not Applicable before the draft is approved" : null;
      },
      // A new draft comes with its twelve checks, all Pending.
      afterWrite: async (pool, req, row, before) => {
        if (before) return;
        await pool.request().input("Land", row.LandId).input("Draft", row.DraftId).input("UserId", req.user?.userId || null)
          .input("Items", JSON.stringify(DRAFT_CHECKS))
          .query("INSERT INTO dbo.LegalDeedDraftCheck (LandId, DraftId, CheckItem, Result, CreatedBy) SELECT @Land, @Draft, j.value, N'Pending', @UserId FROM OPENJSON(@Items) j");
      },
      fields: [
        LAND_ID,
        { name: "DeedId", label: "Deed", type: "ref", ref: "land-deed", filterBy: "LandId", required: true },
        { name: "VersionNo", label: "Version", type: "int", required: true, min: 1, default: 1 },
        { name: "DraftDate", label: "Draft date", type: "date", required: true, default: "today" },
        { name: "DraftFileId", label: "Draft document", type: "file", required: true },
        { name: "ChangeNotes", label: "What changed", type: "textarea", max: 1000 },
        { name: "ReviewStatus", label: "Verification", type: "select", required: true, options: ["Pending", "Approved", "Correction Required", "Rejected"], default: "Pending" },
        { name: "ReviewRemarks", label: "Reviewer remarks", type: "textarea", max: 1000, requiredWhen: { field: "ReviewStatus", values: ["Correction Required", "Rejected"] } },
        ACTIVE,
      ],
    }),
  "deed-draft-check": landChild("Draft Check", "LegalDeedDraftCheck", "CheckId",
    "The twelve checks of each draft version.", {
      label: "r.CheckItem", orderBy: "DraftId, CheckId",
      unique: [["DraftId", "CheckItem"], "This check is already on the draft"],
      review: { field: "Result", by: "CheckedBy", at: "CheckedAt" },
      fields: [
        LAND_ID,
        { name: "DraftId", label: "Draft", type: "ref", ref: "deed-draft", filterBy: "LandId", required: true },
        { name: "CheckItem", label: "Check", type: "select", required: true, options: DRAFT_CHECKS },
        { name: "Result", label: "Result", type: "select", required: true, options: ["Pending", "Correct", "Incorrect", "Not Applicable"], default: "Pending" },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 500, requiredWhen: { field: "Result", values: ["Incorrect"] } },
        ACTIVE,
      ],
    }),
  "stamp-duty": landChild("Stamp Duty & Fees", "LegalStampDuty", "CalculationId",
    "Stamp duty and registration fee as calculated by an approved source (never a hard-coded rate), with its source and verification.", {
      label: "CONVERT(NVARCHAR(10), r.CalculationDate, 105) + ' ₹' + CONVERT(NVARCHAR(30), r.TotalPayable)", orderBy: "CalculationDate", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "DeedId", label: "Deed", type: "ref", ref: "land-deed", filterBy: "LandId", required: true },
        { name: "GovtMarketValue", label: "Government market value (₹)", type: "decimal" },
        { name: "ConsiderationValue", label: "Consideration value (₹)", type: "decimal" },
        { name: "ValuationBasis", label: "Valuation basis", type: "text", max: 300 },
        { name: "StampDuty", label: "Stamp duty (₹)", type: "decimal" },
        { name: "RegistrationFee", label: "Registration fee (₹)", type: "decimal" },
        { name: "ScanningFee", label: "Scanning fee (₹)", type: "decimal" },
        { name: "OtherCharges", label: "Other government charges (₹)", type: "decimal" },
        { name: "TotalPayable", label: "Total payable (₹)", type: "decimal", required: true, min: 0.01 },
        { name: "CalculationDate", label: "Calculation date", type: "date", required: true, default: "today" },
        { name: "CalculationSource", label: "Calculation source", type: "text", required: true, max: 300 },
        { name: "SupportingFileId", label: "Supporting document", type: "file" },
        VERIFICATION,
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "reg-payment": landChild("Registration Payment", "LegalRegPayment", "RegPaymentId",
    "Stamp duty, registration and other fees paid for the deed (GRN / challan).", {
      label: "CONVERT(NVARCHAR(10), r.PaymentDate, 105) + ' ₹' + CONVERT(NVARCHAR(30), r.Amount)", orderBy: "PaymentDate", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "DeedId", label: "Deed", type: "ref", ref: "land-deed", filterBy: "LandId", required: true },
        { name: "FeeTypeId", label: "Fee type", type: "ref", ref: "fee-type", required: true },
        { name: "Amount", label: "Amount (₹)", type: "decimal", required: true, min: 0.01 },
        { name: "PaymentDate", label: "Payment date", type: "date", required: true, default: "today" },
        { name: "PaymentRef", label: "Payment reference (GRN / challan)", type: "text", max: 100 },
        { name: "ReceiptFileId", label: "Receipt", type: "file" },
        VERIFICATION,
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "reg-appointment": landChild("Registration Appointment", "LegalRegAppointment", "AppointmentId",
    "Appointment at the registration office, attendance and witnesses.", {
      label: "CONVERT(NVARCHAR(10), r.AppointmentDate, 105) + ISNULL(' ' + r.AppointmentTime, '') + ' - ' + r.AppointmentStatus", orderBy: "AppointmentDate",
      fields: [
        LAND_ID,
        { name: "DeedId", label: "Deed", type: "ref", ref: "land-deed", filterBy: "LandId", required: true },
        { name: "RegistrationOfficeId", label: "Registration office", type: "ref", ref: "registration-office", required: true },
        { name: "AppointmentDate", label: "Appointment date", type: "date", required: true },
        { name: "AppointmentTime", label: "Time (e.g. 11:30)", type: "text", max: 10, pattern: "^([01]?[0-9]|2[0-3]):[0-5][0-9]$", patternMsg: "Time must look like 11:30" },
        { name: "TokenNo", label: "Registration token number", type: "text", max: 60 },
        { name: "BuyerAttendance", label: "Buyer attendance", type: "select", required: true, options: ["Pending", "Present", "Absent"], default: "Pending" },
        { name: "SellerAttendance", label: "Seller attendance", type: "select", required: true, options: ["Pending", "Present", "Absent"], default: "Pending" },
        { name: "WitnessDetails", label: "Witness details", type: "textarea", max: 1000 },
        { name: "AppointmentStatus", label: "Status", type: "select", required: true, options: ["Scheduled", "Rescheduled", "Completed", "Cancelled", "Missed"], default: "Scheduled" },
        { name: "SlipFileId", label: "Appointment slip", type: "file" },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "reg-attempt": landChild("Registration Attempt", "LegalRegAttempt", "AttemptId",
    "Each attempt at the Sub-Registrar office. A failed attempt stays in the history; the next one is a new record.", {
      label: "CONVERT(NVARCHAR(10), r.AttemptDate, 105) + ' - ' + r.Result", orderBy: "AttemptDate, AttemptId",
      // The deed follows the latest attempt: successful → registered with its number; otherwise correction required.
      afterWrite: async (pool, req, row) => {
        const ok = row.Result === "Successful";
        await pool.request().input("Deed", row.DeedId).input("No", row.RegisteredDeedNo).input("UserId", req.user?.userId || null)
          .input("Status", ok ? "Successfully Registered" : row.Result === "Adjourned" ? "Registration Pending" : "Correction Required")
          .query(`UPDATE dbo.LegalLandDeed SET RegistrationStatus = @Status, RegisteredDeedNo = CASE WHEN @Status = N'Successfully Registered' THEN @No ELSE RegisteredDeedNo END,
                  UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE DeedId = @Deed`);
      },
      fields: [
        LAND_ID,
        { name: "DeedId", label: "Deed", type: "ref", ref: "land-deed", filterBy: "LandId", required: true },
        { name: "AppointmentId", label: "Appointment", type: "ref", ref: "reg-appointment", filterBy: "LandId" },
        { name: "AttemptDate", label: "Attempt date", type: "date", required: true, default: "today" },
        { name: "Result", label: "Registration successful?", type: "select", required: true, options: ["Successful", "Failed", "Correction Required", "Adjourned"] },
        { name: "RegisteredDeedNo", label: "Registered deed number", type: "text", max: 60, requiredWhen: { field: "Result", values: ["Successful"] } },
        { name: "FailureReason", label: "Reason / correction needed", type: "textarea", max: 1000, requiredWhen: { field: "Result", values: ["Failed", "Correction Required", "Adjourned"] } },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "registered-deed": landChild("Registered Deed", "LegalRegisteredDeed", "RegisteredId",
    "The final registered deed and its approval.", {
      label: "r.RegisteredDeedNo", orderBy: "RegistrationDate",
      review: { field: "ApprovalStatus", by: "ApprovedBy", at: "ApprovedAt" },
      check: async (pool, values) => {
        const ok = (await pool.request().input("Deed", values.DeedId).query("SELECT TOP 1 1 AS ok FROM dbo.LegalRegAttempt WHERE DeedId = @Deed AND Result = N'Successful' AND IsActive = 1")).recordset[0];
        return ok ? null : "Record the successful registration attempt first";
      },
      fields: [
        LAND_ID,
        { name: "DeedId", label: "Deed", type: "ref", ref: "land-deed", filterBy: "LandId", required: true, fill: { RegisteredDeedNo: "RegisteredDeedNo", RegistrationOfficeId: "RegistrationOfficeId" } },
        { name: "RegisteredDeedNo", label: "Registered deed number", type: "text", required: true, max: 60 },
        { name: "RegistrationDate", label: "Registration date", type: "date", required: true },
        { name: "RegistrationOfficeId", label: "Registration office", type: "ref", ref: "registration-office" },
        { name: "DeedFileId", label: "Registered deed (PDF)", type: "file", required: true },
        { name: "ReceiptFileId", label: "Registration receipt", type: "file" },
        { name: "CertifiedCopyStatus", label: "Certified copy", type: "select", required: true, options: ["Not Applied", "Applied", "Received"], default: "Not Applied" },
        { name: "ApprovalStatus", label: "Deed approval", type: "select", required: true, options: ["Pending", "Verified", "Approved", "Correction Required", "Rejected"], default: "Pending" },
        { name: "ApprovalRemarks", label: "Approval remarks", type: "textarea", max: 1000, requiredWhen: { field: "ApprovalStatus", values: ["Correction Required", "Rejected"] } },
        ACTIVE,
      ],
    }),

  // ── Phase 6: mutation & closure ──
  mutation: landChild("Mutation", "LegalMutation", "MutationId",
    "The mutation application at the BL&LRO, tracked apart from registration: a registered deed is not a completed mutation.", {
      label: "ISNULL(r.ApplicationNo, 'Mutation ' + CAST(r.MutationId AS NVARCHAR(10))) + ' - ' + r.ApplicationStatus", orderBy: "MutationId",
      review: { field: "ApplicationStatus", by: "DecidedBy", at: "DecidedAt", free: ["Not Applied", "Draft", "Submitted", "Under Process", "Hearing Scheduled", "Objection Raised", "Correction Required"] },
      fields: [
        LAND_ID,
        { name: "RegisteredDeedId", label: "Registered deed", type: "ref", ref: "registered-deed", filterBy: "LandId" },
        { name: "ApplicationNo", label: "Mutation application number", type: "text", max: 80 },
        { name: "ApplicationDate", label: "Application date", type: "date" },
        { name: "OfficeName", label: "BL&LRO office", type: "text", required: true, max: 200 },
        { name: "MouzaId", label: "Mouza", type: "ref", ref: "mouza" },
        { name: "DagNo", label: "Dag number", type: "text", max: 60 },
        { name: "PreviousKhatian", label: "Previous Khatian", type: "text", max: 60 },
        { name: "PreviousOwner", label: "Previous owner(s)", type: "text", max: 300 },
        { name: "NewOwner", label: "New owner(s)", type: "text", required: true, max: 300 },
        { name: "ApplicationStatus", label: "Application status", type: "select", required: true, options: MUTATION_STATUSES, default: "Draft" },
        { name: "HearingDate", label: "Hearing date", type: "date" },
        { name: "ObjectionDetails", label: "Objection details", type: "textarea", max: 1000, requiredWhen: { field: "ApplicationStatus", values: ["Objection Raised"] } },
        { name: "OrderNo", label: "Mutation order number", type: "text", max: 80, requiredWhen: { field: "ApplicationStatus", values: ["Approved"] } },
        { name: "OrderDate", label: "Mutation order date", type: "date", requiredWhen: { field: "ApplicationStatus", values: ["Approved"] } },
        { name: "DocFileId", label: "Application copy", type: "file" },
        { name: "OrderFileId", label: "Mutation order", type: "file" },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "mutation-hearing": landChild("Mutation Hearing", "LegalMutationHearing", "HearingId",
    "Hearings, objections and follow-up of the mutation.", {
      label: "CONVERT(NVARCHAR(10), r.HearingDate, 105)", orderBy: "MutationId, HearingDate",
      fields: [
        LAND_ID,
        { name: "MutationId", label: "Mutation", type: "ref", ref: "mutation", filterBy: "LandId", required: true },
        { name: "HearingDate", label: "Hearing date", type: "date", required: true },
        { name: "ObjectionRaised", label: "Objection raised", type: "select", required: true, options: ["No", "Yes"], default: "No" },
        { name: "Outcome", label: "Outcome", type: "textarea", max: 1000 },
        { name: "NextDate", label: "Next date", type: "date", after: "HearingDate" },
        { name: "DocFileId", label: "Hearing record", type: "file" },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 500 },
        ACTIVE,
      ],
    }),
  "mutation-record": landChild("New Khatian / RoR", "LegalMutationRecord", "RecordId",
    "The new LR Khatian and Dag after mutation. The old RS / LR records stay as history.", {
      label: "'LR Kh ' + r.NewLrKhatianNo + ' / Dag ' + r.NewLrDagNo", orderBy: "RecordId", review: REVIEW,
      fields: [
        LAND_ID,
        { name: "MutationId", label: "Mutation", type: "ref", ref: "mutation", filterBy: "LandId", required: true },
        { name: "NewLrKhatianNo", label: "New LR Khatian number", type: "text", required: true, max: 30 },
        { name: "NewLrDagNo", label: "New LR Dag number", type: "text", required: true, max: 30 },
        { name: "RecordedHolder", label: "Recorded holder", type: "text", required: true, max: 300 },
        { name: "NewSharePct", label: "New ownership share (%)", type: "decimal", maxValue: 100 },
        { name: "LandTypeId", label: "Land classification", type: "ref", ref: "land-type" },
        { name: "UpdatedArea", label: "Updated area", type: "decimal" },
        { name: "AreaUnitId", label: "Area unit", type: "ref", ref: "area-unit", requiredWith: "UpdatedArea" },
        { name: "RorDate", label: "RoR date", type: "date" },
        { name: "MutationOrderNo", label: "Mutation order number", type: "text", max: 80 },
        { name: "MutationOrderDate", label: "Mutation order date", type: "date" },
        { name: "RorFileId", label: "Updated RoR copy", type: "file" },
        VERIFICATION,
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000 },
        ACTIVE,
      ],
    }),
  "final-check": landChild("Final Verification", "LegalFinalCheck", "CheckId",
    "The final reviewer's confirmation of each closing item.", {
      label: "r.CheckItem + ' - ' + r.Result", orderBy: "CheckId",
      unique: [["LandId", "CheckItem"], "This check is already on the list"],
      review: { field: "Result", by: "CheckedBy", at: "CheckedAt" },
      fields: [
        LAND_ID,
        { name: "CheckItem", label: "Check", type: "select", required: true, options: FINAL_CHECKS },
        { name: "Result", label: "Result", type: "select", required: true, options: ["Pending", "Confirmed", "Issue Found", "Not Applicable"], default: "Pending" },
        { name: "Remarks", label: "Remarks", type: "textarea", max: 1000, requiredWhen: { field: "Result", values: ["Issue Found", "Not Applicable"] } },
        ACTIVE,
      ],
    }),
  settlement: landChild("Financial Settlement", "LegalSettlement", "SettlementId",
    "The final financial settlement of a purchase / sale. Only a reviewer can approve it.", {
      label: "CONVERT(NVARCHAR(10), r.SettlementDate, 105) + ' - ' + r.SettlementStatus", orderBy: "SettlementDate",
      review: { field: "SettlementStatus", by: "ApprovedBy", at: "ApprovedAt", free: ["Draft", "Submitted"] },
      fields: [
        LAND_ID,
        { name: "TransactionId", label: "Purchase / sale", type: "ref", ref: "land-transaction", filterBy: "LandId", required: true, fill: { AgreementValue: "TotalValue" } },
        { name: "AgreementValue", label: "Agreement value (₹)", type: "decimal", required: true },
        { name: "TotalReceived", label: "Total received (₹)", type: "decimal" },
        { name: "TotalPaid", label: "Total paid (₹)", type: "decimal" },
        { name: "RemainingBalance", label: "Remaining balance (₹)", type: "decimal", signed: true },
        { name: "BrokerCommission", label: "Broker commission (₹)", type: "decimal" },
        { name: "AdvocateFees", label: "Advocate fees (₹)", type: "decimal" },
        { name: "RegistrationCharges", label: "Registration charges (₹)", type: "decimal" },
        { name: "OtherExpenses", label: "Other expenses (₹)", type: "decimal" },
        { name: "Refunds", label: "Refunds (₹)", type: "decimal" },
        { name: "SettlementDate", label: "Settlement date", type: "date", required: true, default: "today" },
        { name: "SettlementStatus", label: "Settlement status", type: "select", required: true, options: ["Draft", "Submitted", "Approved", "Rejected"], default: "Draft" },
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
  // Who verifies and who approves at L1 / L2 — the super admin's control panel (see approvalAuthority.js).
  "approval-authority": {
    title: "Approval Control", group: "Workflow", pageKey: "legal-approval-authority-master", table: "LegalApprovalAuthority", pk: "AuthorityId",
    desc: "Which users verify records and documents, and which users approve deeds at L1 and at L2. Only an administrator can change it.",
    label: "Stage + ' - ' + (SELECT name FROM dbo.users WHERE id = r.ApproverId)", orderBy: "Stage, ApproverId", adminOnly: true,
    unique: [["Stage", "ApproverId"], "This user already has this approval role"],
    fields: [
      { name: "Stage", label: "Approval role", type: "select", required: true, options: ["Verifier", "L1 Approver", "L2 Approver"] },
      { name: "ApproverId", label: "User", type: "ref", ref: "user", required: true },
      { name: "Remarks", label: "Remarks", type: "textarea", max: 500 },
      ACTIVE,
    ],
  },
  // Shown on the Approval Control page: a route's SLA and escalation. Who approves is set per user in
  // Approval Control, and maker-checker is always on, so the old role / separation fields are not asked for.
  "approval-workflow": {
    adminOnly: true,
    title: "Approval Route & SLA", group: "Workflow", pageKey: "legal-approval-authority-master", table: "LegalApprovalWorkflow", pk: "WorkflowId",
    desc: "Each approval route used by a registration task: days allowed at L1 and L2, and who it escalates to when late.",
    label: "WorkflowName", orderBy: "WorkflowName",
    unique: [["WorkflowName"], "A route with this name already exists"],
    fields: [
      { name: "WorkflowName", label: "Route name", type: "text", required: true, max: 150 },
      { name: "L1SlaDays", label: "L1 SLA (days)", type: "int", required: true, min: 1, default: 2 },
      { name: "L2SlaDays", label: "L2 SLA (days)", type: "int", required: true, min: 1, default: 2 },
      { name: "EscalationRoleId", label: "Escalate to role", type: "ref", ref: "role" },
      { name: "EffectiveFrom", label: "Effective from", type: "date", required: true },
      { name: "EffectiveTo", label: "Effective to", type: "date", after: "EffectiveFrom" },
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
    adminOnly: true,
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
};

// Buying and selling are two views of LegalLandTransaction, kept apart by TxnType:
//   land-purchase — the company acquiring the land (pipeline step 8); sellers are the land's current owners;
//   land-sale     — the company selling an acquired land later (the land's Sales section).
// "land-transaction" stays as the picker over both (payments, agreements, deeds and settlements point at it).
{
  const txn = MASTERS["land-transaction"];
  const base = txn.fields.filter((f) => f.name !== "TxnType");
  MASTERS["land-purchase"] = {
    ...txn, title: "Purchase", scope: { column: "TxnType", value: "Purchase" }, check: undefined,
    desc: "The company acquiring this land. Sellers are the land's current owners; the whole land (all owners' shares) can be bought in one purchase.",
    fields: base.map((f) => (f.name === "BuyerName" ? { ...f, label: "Buyer (company)" } : f.name === "SellerNames" ? { ...f, label: "Seller(s) — the current owners" } : f)),
  };
  MASTERS["land-sale"] = {
    ...txn, title: "Sale", scope: { column: "TxnType", value: "Sale" },
    desc: "The company selling this land (or part of it) after acquiring it. The same area cannot be sold twice.",
    // Only an acquired land can be sold, and never more than its unsold area.
    check: async (pool, values, id) => {
      const acquired = (await pool.request().input("Land", values.LandId).query(`
        SELECT TOP 1 1 AS ok FROM dbo.LegalWorkflowStepState WHERE LandId = @Land AND StepCode = N'OWNERSHIP_TRANSFER' AND Status = N'Completed'`)).recordset[0];
      if (!acquired) return "This land is not acquired yet — complete the purchase up to the ownership transfer (step 23) first";
      return txn.check(pool, { ...values, TxnType: "Sale" }, id);
    },
    fields: base.map((f) => (f.name === "SellerNames" ? { ...f, label: "Seller (the company)" } : f)),
  };
  txn.lookupOnly = true;

  // Only land the company has acquired (ownership transferred, step 23) can be sold.
  MASTERS["acquired-land"] = {
    ...MASTERS.land, title: "Land the company has acquired (ownership transferred, step 23)", lookupOnly: true,
    where: "EXISTS (SELECT 1 FROM dbo.LegalWorkflowStepState s WHERE s.LandId = {t}LandId AND s.StepCode = N'OWNERSHIP_TRANSFER' AND s.Status = N'Completed')",
  };
  MASTERS["land-sale"].fields = MASTERS["land-sale"].fields.map((f) =>
    (f.name === "LandId" ? { ...f, ref: "acquired-land", label: "Acquired land property" } : f));
}

// Pickers backed by core ERP tables rather than a Legal master.
const EXTERNAL_REFS = {
  project: { sql: "SELECT id AS value, name AS label FROM dbo.enterprise WHERE business_type = 'P' ORDER BY name", exists: "SELECT 1 FROM dbo.enterprise WHERE id = @v AND business_type = 'P'" },
  role: { sql: "SELECT RId AS value, RName AS label FROM dbo.Role ORDER BY RName", exists: "SELECT 1 FROM dbo.Role WHERE RId = @v" },
  user: { sql: "SELECT id AS value, name AS label FROM dbo.users ORDER BY name", exists: "SELECT 1 FROM dbo.users WHERE id = @v" },
};

module.exports = { MASTERS, EXTERNAL_REFS, DUE_DILIGENCE_CHECKS, VERIFICATION_CHECKS, FINAL_CHECKS };
