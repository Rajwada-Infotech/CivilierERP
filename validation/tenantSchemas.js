const { z } = require("zod");

// ─── Shared primitives ────────────────────────────────────────────────────────

const trimmedString = (max) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1).max(max),
  );

const optionalTrimmedString = (max) =>
  z.preprocess((v) => {
    if (v === undefined || v === null) return undefined;
    const t = String(v).trim();
    return t === "" ? undefined : t;
  }, z.string().max(max).optional());

const VALID_PLANS = ["Starter", "Basic", "Professional", "Enterprise"];
const VALID_STATUSES = ["active", "suspended", "inactive", "trial"];

// ─── Schemas ──────────────────────────────────────────────────────────────────

// POST / — create tenant
const tenantCreateSchema = z.object({
  tenant_id: trimmedString(100),
  name: trimmedString(200),
  domain: optionalTrimmedString(255),
  admin_email: z
    .preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string().email("Invalid admin email").max(255),
    )
    .optional(),
  plan: z.enum(VALID_PLANS).default("Starter"),
  max_users: z.coerce.number().int().min(1).max(10000).default(10),
  db_name: optionalTrimmedString(100),
  server: optionalTrimmedString(255),
});

// PUT /:id — full update (tenant_id rename allowed)
const tenantUpdateSchema = z.object({
  tenant_id: trimmedString(100),
  name: trimmedString(200),
  domain: optionalTrimmedString(255),
  admin_email: z
    .preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string().email("Invalid admin email").max(255),
    )
    .optional(),
  plan: z.enum(VALID_PLANS).default("Starter"),
  max_users: z.coerce.number().int().min(1).max(10000).default(10),
  db_name: optionalTrimmedString(100),
  server: optionalTrimmedString(255),
  status: z.enum(VALID_STATUSES).default("active"),
});

// PATCH /:id/status — suspend / activate
const tenantPatchStatusSchema = z.object({
  status: z.enum(VALID_STATUSES, {
    errorMap: () => ({
      message: `status must be one of: ${VALID_STATUSES.join(", ")}`,
    }),
  }),
});

module.exports = {
  tenantCreateSchema,
  tenantUpdateSchema,
  tenantPatchStatusSchema,
};
