// validateBody.js — re-exports from validateRequest.js so both import paths work.
// Routes that import from "../middleware/validateBody" resolve correctly.
// The canonical file is validateRequest.js — do not duplicate logic here.
module.exports = require("./validateRequest");