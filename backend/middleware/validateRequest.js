const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.length ? issue.path.join(".") : "body",
      message: issue.message,
    }));
    const summary = details
      .map((detail) => `${detail.field}: ${detail.message}`)
      .join("; ");

    return res.status(400).json({
      error: "Validation failed",
      message: summary || "Please check the submitted fields.",
      details,
    });
  }

  req.body = result.data;
  next();
};

/**
 * Safely parse a URL param or query string value to a non-negative integer.
 * Returns null for NaN, negative numbers, and non-numeric strings.
 *
 * 0 is accepted as valid — a handful of tables in this database (CrmBooking,
 * CrmCustomer, ParkingMaster, and others — see migrations 441/449/450) have
 * a real row at Id 0 from a historical identity-seed corruption, so
 * rejecting 0 here made those rows permanently unreachable through any
 * route using this helper, no matter what downstream code assumed. Callers
 * must check the result with `=== null` / `== null`, NOT `!id` — a valid
 * parsed id of 0 is falsy in JS and `!id` would reject it exactly the same
 * bug this fixes.
 *
 * @example
 *   const id = parseId(req.params.id);
 *   if (id === null) return res.status(400).json({ error: "Invalid id" });
 */
const parseId = (value) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Express middleware factory that validates req.params[paramName] (default "id")
 * is a positive integer and attaches the parsed value to req.parsedId.
 * Rejects with 400 before the route handler runs.
 *
 * @example
 *   router.get("/:id", requireId(), async (req, res) => {
 *     const id = req.parsedId; // guaranteed positive integer
 *   });
 *
 *   router.delete("/:attachId", requireId("attachId"), async (req, res) => {
 *     const id = req.parsedId;
 *   });
 */
const requireId = (paramName = "id") => (req, res, next) => {
  const id = parseId(req.params[paramName]);
  if (id === null) {
    return res.status(400).json({ error: `Invalid ${paramName}: must be a non-negative integer` });
  }
  req.parsedId = id;
  next();
};

module.exports = { validateBody, parseId, requireId };
