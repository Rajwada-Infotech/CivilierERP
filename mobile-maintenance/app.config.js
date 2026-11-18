// google-services.json is not committed (it holds the Firebase API key). EAS builds receive its path through the
// GOOGLE_SERVICES_JSON file secret; local runs fall back to the git-ignored ./google-services.json next to app.json.
// Without either (a local Expo Go run), no Firebase file is set: Expo Go doesn't need it, and naming a missing file
// stops Expo from reading this config at all.
const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON || config.android?.googleServicesFile || "./google-services.json";
  const exists = path.isAbsolute(file) ? fs.existsSync(file) : fs.existsSync(path.join(__dirname, file));
  const android = { ...config.android };
  if (exists || process.env.GOOGLE_SERVICES_JSON) android.googleServicesFile = file;
  else delete android.googleServicesFile;
  return { ...config, android };
};
