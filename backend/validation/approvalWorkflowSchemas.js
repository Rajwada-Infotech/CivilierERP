const { z } = require("zod");
const { optStr } = require("./helpers");

// ── approvalWorkflows ─────────────────────────────────────────────────────────
// Verified against approvalWorkflows.js (POST + PUT):
//   name, type, modules (array -> stored as JSON), levels (array -> stored as
//   JSON; the route never destructures level/approverId/approverRole, so levels
//   is only validated as a non-empty array, not a fixed shape), active

const approvalWorkflowBodySchema = z.object({
  name:    z.string().trim().min(1, "Name is required").max(255),
  type:    optStr(100),
  modules: z.array(z.string().trim().min(1)).min(1, "At least one module is required"),
  levels:  z.array(z.any()).min(1, "At least one approval level is required"),
  active:  z.coerce.boolean().optional(),
}).passthrough();

const approvalWorkflowUpdateSchema = approvalWorkflowBodySchema
  .extend({
    name:    optStr(255),
    type:    optStr(100),
    modules: z.array(z.string().trim().min(1)).min(1).optional(),
    levels:  z.array(z.any()).min(1).optional(),
  })
  .passthrough();

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  approvalWorkflowBodySchema,
  approvalWorkflowUpdateSchema,
};