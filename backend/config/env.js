const path = require("path");
const dotenv = require("dotenv");

const envPath = path.resolve(__dirname, "..", ".env");
const requiredKeys = ["DB_USER", "DB_PASSWORD", "DB_SERVER", "DB_NAME", "JWT_SECRET"];

let loaded = false;

function loadEnv() {
  if (!loaded) {
    dotenv.config({ path: envPath });
    loaded = true;
  }

  const missing = requiredKeys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Add them to backend/.env or provide them in the process environment.",
    );
  }

  return process.env;
}

module.exports = { loadEnv, envPath };
