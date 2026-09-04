const { z } = require("zod");

// backend/routes/crmRegistry.js POST / only ever reads BookingId off the
// body — everything else about starting a registry is derived server-side.
const crmRegistryCreateSchema = z.object({
  BookingId: z.coerce.number().int().positive(),
});

module.exports = { crmRegistryCreateSchema };
