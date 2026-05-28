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

module.exports = { validateBody };
