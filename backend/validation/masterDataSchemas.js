const { z } = require("zod");
const {
  emptyToUndefined,
  optStr,
  optInt,
  optNumber,
} = require("./helpers");

// ── activityMaster ────────────────────────────────────────────────────────────

const activityBodySchema = z.object({
  activity_name:     z.string().trim().min(1, "activity_name is required").max(255),
  short_description: optStr(255),
  activity_type:     z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(1),
  ),
  group_id:  optInt,
  is_active: z.coerce.boolean().optional(),
  hsn_code:  optStr(50),
}).passthrough();

// ── billingTerms ──────────────────────────────────────────────────────────────

const billingTermBodySchema = z.object({
  Name:            optStr(200),
  Description:     optStr(4000),
  CalculationType: optStr(20),
  DeductionType:   optStr(20),
  IsActive:        z.coerce.boolean().optional(),
}).passthrough();

// ── blockMaster ───────────────────────────────────────────────────────────────

const blockBodySchema = z.object({
  ProjectId: z.preprocess(emptyToUndefined, z.coerce.number().int().positive("ProjectId is required")),
  BlockName: z.string().trim().min(1, "BlockName is required").max(100),
  IsActive:  z.coerce.boolean().optional(),
}).passthrough();

// ── companyMaster ─────────────────────────────────────────────────────────────

const companyBodySchema = z.object({
  name:              optStr(255),
  shortName:         optStr(100),
  code:              optStr(100),
  type:              optStr(50),
  legalName:         optStr(4000),
  industry:          optStr(50),
  incorporationDate: optStr(30),
  cinNumber:         optStr(50),
  panNumber:         optStr(20),
  tanNumber:         optStr(15),
  gstType:           z.enum(["Registered", "Unregistered"]).optional(),
  gstNumber:         optStr(100),
  gstDate:           optStr(30),
  tradeLicenseNo:    optStr(100),
  tradeLicenseDate:  optStr(30),
  registeredAddress: optStr(4000),
  city:              optStr(100),
  state:             optStr(100),
  country:           optStr(100),
  pincode:           optStr(10),
  phone:             optStr(20),
  fax:               optStr(30),
  email:             optStr(255),
  website:           optStr(255),
  authorizedCapital: optNumber,
  paidUpCapital:     optNumber,
  currency:          optStr(10),
  fiscalYearStart:   optStr(20),
  auditorName:       optStr(255),
  remarks:           optStr(500),
  logoUrl:           optStr(4000),
  belongsTo:         optStr(100),
  isActive:          z.coerce.boolean().optional(),
}).passthrough();

// ── contractorCategory ────────────────────────────────────────────────────────

const contractorCategoryBodySchema = z.object({
  code:     z.string().trim().min(1, "Code is required").max(50),
  name:     z.string().trim().min(1, "Name is required").max(255),
  isActive: z.coerce.boolean().optional(),
}).passthrough();

// ── godowns ───────────────────────────────────────────────────────────────────

const godownBodySchema = z.object({
  GodownName:   z.string().trim().min(1, "GodownName is required").max(255),
  GodownCode:   optStr(50),
  ShortDesc:    optStr(100),
  Description:  optStr(4000),
  Remarks:      optStr(500),
  EnterpriseID: optInt,
  ProjectID:    optInt,
  Location:     optStr(255),
  IsActive:     z.coerce.boolean().optional(),
}).passthrough();

const godownUpdateSchema = godownBodySchema.extend({
  GodownName: optStr(255),
}).passthrough();

// ── hsn ───────────────────────────────────────────────────────────────────────

const hsnBodySchema = z.object({
  HCode:             z.string().trim().min(1, "HCode is required").max(50),
  HDescription:      optStr(4000),
  HShortDescription: optStr(4000),
  HCGST:             optNumber,
  HSGST:             optNumber,
  HIGST:             optNumber,
  HStatus:           z.coerce.boolean().optional(),
}).passthrough();

const hsnUpdateSchema = hsnBodySchema.omit({ HCode: true }).passthrough();

// ── itemGroup ─────────────────────────────────────────────────────────────────

const itemGroupBodySchema = z.object({
  M_Name:         z.string().trim().min(1, "M_Name is required").max(200),
  M_Description:  optStr(500),
  M_code:         optStr(20),
  M_Type:         optStr(50),
  M_BelongsTo:    z.string().uuid().optional().nullable(),
  M_Group:        optStr(200),
  M_IdentityCode: z.coerce.boolean().optional(),
  M_HSN:          optStr(20),
  M_CGST:         optNumber,
  M_IGST:         optNumber,
  M_SGST:         optNumber,
  M_ApprovedBy:   optInt,
}).passthrough();

// ── uomMaster ─────────────────────────────────────────────────────────────────

const uomBodySchema = z.object({
  UOMName:  z.string().trim().min(1, "UOMName is required").max(50),
  UOMCode:  z.string().trim().min(1, "UOMCode is required").max(20),
  Symbol:   optStr(20),
  Remarks:  optStr(250),
  IsActive: z.coerce.boolean().optional(),
}).passthrough();

// ── unitMaster ────────────────────────────────────────────────────────────────

const unitBodySchema = z.object({
  ProjectId: z.preprocess(emptyToUndefined, z.coerce.number().int().positive("ProjectId is required")),
  BlockId:   z.preprocess(emptyToUndefined, z.coerce.number().int().positive("BlockId is required")),
  UnitName:  z.string().trim().min(1, "UnitName is required").max(100),
  IsActive:  z.coerce.boolean().optional(),
}).passthrough();

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // activityMaster
  activityBodySchema,

  // billingTerms
  billingTermBodySchema,

  // blockMaster
  blockBodySchema,

  // companyMaster
  companyBodySchema,

  // contractorCategory
  contractorCategoryBodySchema,

  // godowns
  godownBodySchema,
  godownUpdateSchema,

  // hsn
  hsnBodySchema,
  hsnUpdateSchema,

  // itemGroup
  itemGroupBodySchema,

  // uomMaster
  uomBodySchema,

  // unitMaster
  unitBodySchema,
};