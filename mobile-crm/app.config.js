// google-services.json is not committed (it holds the Firebase API key). EAS builds receive its path through the
// GOOGLE_SERVICES_JSON file secret; a local run uses the git-ignored ./google-services.json next to app.json when it
// is there. When neither exists (Expo Go on a machine without the file) the key is left out altogether: pointing at a
// missing file makes every start print "Could not parse Expo config: android.googleServicesFile", and Expo Go has no
// remote push to configure anyway.
const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  const local = path.join(__dirname, "google-services.json");
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? "./google-services.json" : undefined);
  const { googleServicesFile: _ignored, ...android } = config.android ?? {};
  return {
    ...config,
    android: googleServicesFile ? { ...android, googleServicesFile } : android,
  };
};
