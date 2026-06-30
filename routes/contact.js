const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const VALID_REASONS = [
  "general",
  "donate",
  "request-blood",
  "partnership",
  "volunteer",
];
const VALID_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const VALID_STATUSES = ["new", "read", "resolved"];

// ─── POST /api/contact (public) ────────────────────────────────────────────────
// Anyone can submit this — donation details, blood requests, or a general
// message. No auth required so it works for visitors who aren't donors yet.
router.post("/", async (req, res) => {
  const {
    name,
    email,
    phone,
    reason = "general",
    blood_group,
    message,
  } = req.body;

  if (!name || !email || !message) {
    return res
      .status(400)
      .json({ error: "name, email, and message are required" });
  }
  if (!VALID_REASONS.includes(reason)) {
    return res.status(400).json({ error: "Invalid reason" });
  }
  if (blood_group && !VALID_GROUPS.includes(blood_group)) {
    return res
      .status(400)
      .json({ error: `blood_group must be one of: ${VALID_GROUPS.join(", ")}` });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO contact_messages (name, email, phone, reason, blood_group, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        phone || null,
        reason,
        blood_group || null,
        message.trim(),
      ],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit message" });
  }
});

// ─── GET /api/contact (admin only) ─────────────────────────────────────────────
router.get("/", requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM contact_messages ORDER BY created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// ─── PATCH /api/contact/:id (admin only) ───────────────────────────────────────
// Used to mark a message as read / resolved.
router.patch("/:id", requireAuth, async (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res
      .status(400)
      .json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE contact_messages SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Message not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update message" });
  }
});

// ─── DELETE /api/contact/:id (admin only) ──────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM contact_messages WHERE id = $1`,
      [req.params.id],
    );
    if (!rowCount) return res.status(404).json({ error: "Message not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

module.exports = router;
