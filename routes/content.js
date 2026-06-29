const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const VALID_SECTIONS = ["hero", "about", "approach", "cta", "footer"];
const VALID_LANGS = ["en", "ur", "fa"];

// ─── GET /api/content/:section ────────────────────────────────────────────────
// Public — returns all three language blobs for a section so the frontend
// can pick the right one without a second request.
router.get("/:section", async (req, res) => {
  const { section } = req.params;
  if (!VALID_SECTIONS.includes(section)) {
    return res.status(404).json({ error: "Unknown section" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT content_en, content_ur, content_fa, updated_at
         FROM page_content WHERE section = $1`,
      [section]
    );
    if (!rows.length) return res.status(404).json({ error: "Section not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch content" });
  }
});

// ─── GET /api/content ─────────────────────────────────────────────────────────
// Public — returns all sections at once (used by the public site on first load).
router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT section, content_en, content_ur, content_fa FROM page_content ORDER BY section`
    );
    // Shape into { hero: { en, ur, fa }, about: { ... }, ... }
    const result = {};
    for (const row of rows) {
      result[row.section] = {
        en: row.content_en,
        ur: row.content_ur,
        fa: row.content_fa,
      };
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch content" });
  }
});

// ─── PUT /api/content/:section/:lang (admin only) ─────────────────────────────
// Admin saves the JSON blob for one language of one section.
router.put("/:section/:lang", requireAuth, async (req, res) => {
  const { section, lang } = req.params;
  if (!VALID_SECTIONS.includes(section)) {
    return res.status(404).json({ error: "Unknown section" });
  }
  if (!VALID_LANGS.includes(lang)) {
    return res.status(400).json({ error: "lang must be en, ur, or fa" });
  }
  const col = `content_${lang}`;
  try {
    const { rows } = await pool.query(
      `UPDATE page_content
         SET ${col} = $1, updated_at = NOW()
       WHERE section = $2
       RETURNING section, content_en, content_ur, content_fa, updated_at`,
      [JSON.stringify(req.body), section]
    );
    if (!rows.length) return res.status(404).json({ error: "Section not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save content" });
  }
});

module.exports = router;
