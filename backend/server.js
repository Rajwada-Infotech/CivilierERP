require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { connectDB } = require("./db");

const ALLOWED_ORIGINS = [
  "http://localhost:8080",
  "http://localhost:5173",
];

async function startServer() {
  try {
    await connectDB();

    const app = express();
    app.use(cors({
      origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
    }));
    app.use(express.json());

    app.get("/", (req, res) => res.send("CivilierERP API running"));
    app.use("/api/users", require("./routes/users"));
    app.use("/api/account-groups", require("./routes/accountGroup"));
    app.use("/api/item-groups", require("./routes/itemGroup"));

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log("Server running on port " + PORT));
  } catch (err) {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  }
}

startServer();
