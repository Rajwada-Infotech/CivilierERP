// google-services.json is not committed (it holds the Firebase API key). EAS builds receive its path through the
// GOOGLE_SERVICES_JSON file secret; local runs fall back to the git-ignored ./google-services.json next to app.json.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON || config.android?.googleServicesFile || "./google-services.json",
  },
});
