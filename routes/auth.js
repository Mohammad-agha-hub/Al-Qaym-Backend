const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { requireAuth, COOKIE_NAME } = require("../middleware/auth");

const TOKEN_TTL = "7d";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days, matches TOKEN_TTL
};

function signToken(admin) {
  return jwt.sign(
    { id: admin.id, email: admin.email, name: admin.name },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────
// Open ONLY when there are zero admins yet (first-run bootstrap).
// Once at least one admin exists, creating more requires being logged in
// as an existing admin — prevents a stranger from registering themselves
// as an admin on a live deployment.
router.post("/register", async (req, res, next) => {
  const { rows: existing } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM admin_users",
  );
  if (existing[0].count > 0) {
    return requireAuth(req, res, () => createAdmin(req, res));
  }
  return createAdmin(req, res);
});

async function createAdmin(req, res) {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ error: "name, email, and password are required" });
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO admin_users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [name, email.toLowerCase().trim(), password_hash],
    );
    const admin = rows[0];
    const token = signToken(admin);
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    res.status(201).json({ admin, token });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create account" });
  }
}

// ─── POST /api/auth/login ────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT * FROM admin_users WHERE email = $1",
      [email.toLowerCase().trim()],
    );
    const user = rows[0];
    // Always compare against a hash (even a dummy one) so the response
    // time/path doesn't leak whether the email exists.
    const valid = user
      ? await bcrypt.compare(password, user.password_hash)
      : await bcrypt.compare(password, "$2a$10$invalidsaltinvalidsaltinv");

    if (!user || !valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const admin = { id: user.id, name: user.name, email: user.email };
    const token = signToken(admin);
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    res.json({ admin, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to log in" });
  }
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: undefined });
  res.json({ message: "Logged out" });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
router.get("/me", requireAuth, (req, res) => {
  res.json({ admin: req.admin });
});

module.exports = router;
