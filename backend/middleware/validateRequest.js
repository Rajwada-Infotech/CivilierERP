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
 * Safely parse a URL param or query string value to a positive integer.
 * Returns null for NaN, 0, negative numbers, and non-numeric strings.
 *
 * @example
 *   const id = parseId(req.params.id);
 *   if (!id) return res.status(400).json({ error: "Invalid id" });
 */
const parseId = (value) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
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
  if (!id) {
    return res.status(400).json({ error: `Invalid ${paramName}: must be a positive integer` });
  }
  req.parsedId = id;
  next();
};

module.exports = { validateBody, parseId, requireId };
