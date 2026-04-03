require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { connectDB } = require("./db");

const ALLOWED_ORIGINS = ["http://localhost:8080", "http://localhost:5173"];

async function startServer() {
  try {
    await connectDB();
    const app = express();
    app.use(cors({ origin: (origin, cb) => (!origin || ALLOWED_ORIGINS.includes(origin)) ? cb(null, true) : cb(new Error("Not allowed by CORS")) }));
    app.use(express.json());

    app.get("/", (req, res) => res.send("CivilierERP API running"));

    app.use("/api/users",           require("./routes/users"));
    app.use("/api/account-group",   require("./routes/accountGroup"));
    app.use("/api/account-head",    require("./routes/accountHeadMaster"));
    app.use("/api/activity-master", require("./routes/activityMaster"));
    app.use("/api/bank-master",     require("./routes/bankMaster"));
    app.use("/api/billing-terms",   require("./routes/billingTerms"));
    app.use("/api/card-master",     require("./routes/cardMaster"));
    app.use("/api/cheque-master",   require("./routes/chequeMaster"));
    app.use("/api/document-type",   require("./routes/documentType"));
    app.use("/api/fin-year",        require("./routes/finYear"));
    app.use("/api/hsn",             require("./routes/hsn"));
    app.use("/api/item-groups",     require("./routes/itemGroup"));
    app.use("/api/tds-master",      require("./routes/tdsMaster"));
    app.use("/api/enterprises",     require("./routes/enterprise"));
    app.use("/api/entry-type",      require("./routes/entryType"));
    app.use("/api/expense-booking", require("./routes/expenseBooking"));
    app.use("/api/new-payment",     require("./routes/newPayment"));
    app.use("/api/purchase-orders", require("./routes/purchaseOrders"));
    app.use("/api/tenants",         require("./routes/tenants"));
    app.use("/api/dba",             require("./routes/dba"));
    app.use("/api/user-profile",    require("./routes/userProfile"));

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log("Server running on port " + PORT));
  } catch (err) {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  }
}

startServer();
