const { checkPermission } = require("./permissions");

const METHOD_ACTIONS = {
  GET: "CanView",
  HEAD: "CanView",
  OPTIONS: "CanView",
  POST: "CanAdd",
  PUT: "CanEdit",
  PATCH: "CanEdit",
  DELETE: "CanDelete",
};

function checkPermissionForMethod(module, subModule) {
  return (req, res, next) => {
    const action = METHOD_ACTIONS[req.method];
    if (!action) {
      return res.status(405).json({ error: "Method not allowed" });
    }

    return checkPermission(module, subModule, action)(req, res, next);
  };
}

module.exports = { checkPermissionForMethod };
