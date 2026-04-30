const { z } = require("zod");

const legacyApiSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  baseUrl: z.string().trim().url().max(1000),
  apiKey: z.string().trim().max(1000),
  status: z.enum(["active", "inactive"]).default("active"),
});

const communicatorConfigSchema = z.object({
  config: z.object({
    apis: z.array(legacyApiSchema).optional(),
  }).passthrough(),
});

module.exports = { communicatorConfigSchema };
