const { z } = require("zod");

// ── primitive coercions ───────────────────────────────────────────────────────

const emptyToUndefined = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

const optStr = (max) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const reqStr = (max, message) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z
      .string({ required_error: message, invalid_type_error: message })
      .min(1, message)
      .max(max),
  );

const optInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().optional(),
);

const reqInt = (message) =>
  z.preprocess(
    (value) => {
      const cleaned = emptyToUndefined(value);
      return cleaned === undefined ? cleaned : Number(cleaned);
    },
    z
      .number({ required_error: message, invalid_type_error: message })
      .int(message)
      .positive(message),
  );

const optNumber = z.preprocess(
  emptyToUndefined,
  z.coerce.number().finite().optional(),
);

const reqNonNegativeNumber = (message) =>
  z.preprocess(
    (value) => {
      const cleaned = emptyToUndefined(value);
      return cleaned === undefined ? cleaned : Number(cleaned);
    },
    z
      .number({ required_error: message, invalid_type_error: message })
      .finite(message)
      .min(0, message),
  );

const optDate = z.preprocess(emptyToUndefined, z.coerce.date().optional());

const reqDate = (message) =>
  z.preprocess(
    (value) => {
      const cleaned = emptyToUndefined(value);
      return cleaned === undefined ? cleaned : new Date(cleaned);
    },
    z.date({ required_error: message, invalid_type_error: message }),
  );

const jsonPassthrough = z.any().optional();

const noteField = z.object({ note: optStr(2000) }).passthrough();

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  emptyToUndefined,
  optStr,
  reqStr,
  optInt,
  reqInt,
  optNumber,
  reqNonNegativeNumber,
  optDate,
  reqDate,
  jsonPassthrough,
  noteField,
};