require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const cron = require("node-cron");
const pool = require("./config/db");

const donorsRouter = require("./routes/donors");
const authRouter = require("./routes/auth");
const blogRouter = require("./routes/blog");
const contentRouter = require("./routes/content");

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, // required so the browser sends/receives the admin_token cookie
  }),
);
app.use(express.json());
app.use(cookieParser());

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use("/api/donors", donorsRouter);
app.use("/api/auth", authRouter);
app.use("/api/blog", blogRouter);
app.use("/api/content", contentRouter);

app.get("/health", (_req, res) =>
  res.json({ status: "ok", timestamp: new Date().toISOString() }),
);

// ─── Cron: expire cooldowns every hour ──────────────────────────────────────
// At minute 0 of every hour, check for donors whose cooldown has ended
cron.schedule("0 * * * *", async () => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE donors
         SET can_donate    = TRUE,
             is_available  = TRUE,
             cooldown_until = NULL
       WHERE cooldown_until IS NOT NULL
         AND cooldown_until <= NOW()`,
    );
    if (rowCount > 0) {
      console.log(
        `[cron] ${rowCount} donor(s) cooldown expired — marked available`,
      );
    }
  } catch (err) {
    console.error("[cron] Failed to expire cooldowns:", err.message);
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Donor Admin API running on http://localhost:${PORT}`);
  console.log(`    Health check: http://localhost:${PORT}/health`);
  console.log(`    Donors API:   http://localhost:${PORT}/api/donors`);
});
