const express = require("express");
const router = express.Router();
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB is plenty for a donor CSV
});

const VALID_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * After fetching a row, recompute is_available / can_donate live
 * if the cooldown has already expired (in case the cron hasn't run yet).
 */
async function syncCooldownIfExpired(donor) {
  if (!donor.cooldown_until) return donor;
  const now = new Date();
  const until = new Date(donor.cooldown_until);
  if (until <= now) {
    // Cooldown expired — mark donor available again
    const { rows } = await pool.query(
      `UPDATE donors
         SET can_donate    = TRUE,
             is_available  = TRUE,
             cooldown_until = NULL
       WHERE id = $1
       RETURNING *`,
      [donor.id],
    );
    return rows[0];
  }
  return donor;
}

/** Compute remaining seconds in cooldown for the response payload */
function attachCooldownSeconds(donor) {
  if (!donor.cooldown_until)
    return { ...donor, cooldown_seconds_remaining: null };
  const diff = Math.max(
    0,
    Math.floor((new Date(donor.cooldown_until) - new Date()) / 1000),
  );
  return { ...donor, cooldown_seconds_remaining: diff };
}

// ─── GET /api/donors ─────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM donors ORDER BY created_at DESC`,
    );

    // Sync any expired cooldowns on the fly
    const updated = await Promise.all(rows.map(syncCooldownIfExpired));
    res.json(updated.map(attachCooldownSeconds));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch donors" });
  }
});

// ─── GET /api/donors/:id ─────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM donors WHERE id = $1`, [
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: "Donor not found" });
    const donor = await syncCooldownIfExpired(rows[0]);
    res.json(attachCooldownSeconds(donor));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch donor" });
  }
});

// ─── POST /api/donors ────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const { name, contact_number, blood_group, can_donate = true } = req.body;

  if (!name || !contact_number || !blood_group) {
    return res
      .status(400)
      .json({ error: "name, contact_number, and blood_group are required" });
  }

  if (!VALID_GROUPS.includes(blood_group)) {
    return res
      .status(400)
      .json({ error: `blood_group must be one of: ${VALID_GROUPS.join(", ")}` });
  }

  try {
    let is_available = can_donate;
    let cooldown_until = null;

    if (!can_donate) {
      cooldown_until = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // +60 days
      is_available = false;
    }

    const { rows } = await pool.query(
      `INSERT INTO donors (name, contact_number, blood_group, can_donate, is_available, cooldown_until)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        name,
        contact_number,
        blood_group,
        can_donate,
        is_available,
        cooldown_until,
      ],
    );

    res.status(201).json(attachCooldownSeconds(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create donor" });
  }
});

// ─── PUT /api/donors/:id ─────────────────────────────────────────────────────
router.put("/:id", requireAuth, async (req, res) => {
  try {
    // Fetch current state first
    const existing = await pool.query(`SELECT * FROM donors WHERE id = $1`, [
      req.params.id,
    ]);
    if (!existing.rows.length)
      return res.status(404).json({ error: "Donor not found" });

    const current = existing.rows[0];
    const {
      name = current.name,
      contact_number = current.contact_number,
      blood_group = current.blood_group,
    } = req.body;

    // can_donate logic:
    // If caller sends can_donate explicitly, use it; otherwise keep current
    let can_donate =
      "can_donate" in req.body ? req.body.can_donate : current.can_donate;
    let is_available = current.is_available;
    let cooldown_until = current.cooldown_until;

    const prevCanDonate = current.can_donate;

    if ("can_donate" in req.body) {
      if (!can_donate && prevCanDonate) {
        // Transitioning FALSE → start cooldown
        cooldown_until = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // +60 days
        is_available = false;
      } else if (can_donate) {
        // Manually re-enabling (admin override)
        cooldown_until = null;
        is_available = true;
      }
    }

    // is_available can also be set directly by admin ONLY when can_donate is true
    if ("is_available" in req.body && can_donate) {
      is_available = req.body.is_available;
    }

    const validGroups = VALID_GROUPS;
    if (!validGroups.includes(blood_group)) {
      return res
        .status(400)
        .json({
          error: `blood_group must be one of: ${validGroups.join(", ")}`,
        });
    }

    const { rows } = await pool.query(
      `UPDATE donors
         SET name           = $1,
             contact_number = $2,
             blood_group    = $3,
             can_donate     = $4,
             is_available   = $5,
             cooldown_until = $6
       WHERE id = $7
       RETURNING *`,
      [
        name,
        contact_number,
        blood_group,
        can_donate,
        is_available,
        cooldown_until,
        req.params.id,
      ],
    );

    res.json(attachCooldownSeconds(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update donor" });
  }
});

// ─── DELETE /api/donors/:id ──────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM donors WHERE id = $1`, [
      req.params.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: "Donor not found" });
    res.json({ message: "Donor deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete donor" });
  }
});

// ─── POST /api/donors/bulk-upload ────────────────────────────────────────────
// Accepts a CSV with headers: name, contact_number, blood_group[, can_donate]
// Inserts valid rows, skips and reports invalid ones rather than failing
// the whole batch — one bad row in a 500-row file shouldn't block the rest.
router.post(
  "/bulk-upload",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No CSV file uploaded (field name: file)" });
    }

    let records;
    try {
      records = parse(req.file.buffer, {
        columns: (header) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
      });
    } catch (err) {
      return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
    }

    if (!records.length) {
      return res.status(400).json({ error: "CSV file has no data rows" });
    }

    const created = [];
    const errors = [];

    for (let i = 0; i < records.length; i++) {
      const rowNum = i + 2; // +1 for 0-index, +1 for header row
      const row = records[i];
      const name = row.name?.trim();
      const contact_number = row.contact_number?.trim();
      const blood_group = row.blood_group?.trim().toUpperCase();
      const can_donateRaw = (row.can_donate ?? "true").toString().trim().toLowerCase();
      const can_donate = !["false", "0", "no"].includes(can_donateRaw);

      if (!name || !contact_number || !blood_group) {
        errors.push({ row: rowNum, error: "Missing name, contact_number, or blood_group" });
        continue;
      }
      if (!VALID_GROUPS.includes(blood_group)) {
        errors.push({ row: rowNum, error: `Invalid blood_group "${blood_group}"` });
        continue;
      }

      try {
        const is_available = can_donate;
        const cooldown_until = can_donate
          ? null
          : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

        const { rows } = await pool.query(
          `INSERT INTO donors (name, contact_number, blood_group, can_donate, is_available, cooldown_until)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [name, contact_number, blood_group, can_donate, is_available, cooldown_until],
        );
        created.push(rows[0]);
      } catch (err) {
        errors.push({ row: rowNum, error: "Database error inserting row" });
      }
    }

    res.status(207).json({
      created_count: created.length,
      error_count: errors.length,
      created,
      errors,
    });
  },
);

module.exports = router;
