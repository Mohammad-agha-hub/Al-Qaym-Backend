const express = require("express");
const router = express.Router();
const multer = require("multer");
const pool = require("../config/db");
const cloudinary = require("../config/cloudinary");
const { requireAuth } = require("../middleware/auth");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB cap for blog cover images
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

async function uniqueSlug(title, excludeId = null) {
  const base = slugify(title) || "post";
  let slug = base;
  let n = 1;
  // Loop until we find a slug that isn't taken by a *different* post
  while (true) {
    const { rows } = await pool.query(
      `SELECT id FROM blog_posts WHERE slug = $1 AND ($2::int IS NULL OR id != $2)`,
      [slug, excludeId],
    );
    if (!rows.length) return slug;
    slug = `${base}-${++n}`;
  }
}

// ─── POST /api/blog/upload-image (admin only) ────────────────────────────────
// Used by the blog editor's image picker. Uploads the file to Cloudinary
// and returns the hosted URL — the post itself just stores that URL string,
// it never touches raw image bytes.
router.post("/upload-image", requireAuth, upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded (field name: image)" });
  }
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    return res.status(500).json({
      error: "Cloudinary is not configured on the server (missing CLOUDINARY_* env vars)",
    });
  }

  try {
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "al-qayim-aid/blog", resource_type: "image" },
        (err, result) => (err ? reject(err) : resolve(result)),
      );
      stream.end(req.file.buffer);
    });
    res.json({ url: uploadResult.secure_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upload image" });
  }
});

// ─── GET /api/blog ────────────────────────────────────────────────────────────
// Public — the landing page reads this. Admins (logged in) also see drafts
// when ?all=true is passed; everyone else only sees published posts.
router.get("/", async (req, res) => {
  try {
    const onlyPublished = req.query.all !== "true";
    const { rows } = await pool.query(
      onlyPublished
        ? `SELECT * FROM blog_posts WHERE published = TRUE ORDER BY created_at DESC`
        : `SELECT * FROM blog_posts ORDER BY created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// ─── GET /api/blog/:slug ──────────────────────────────────────────────────────
router.get("/:slug", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM blog_posts WHERE slug = $1`,
      [req.params.slug],
    );
    if (!rows.length) return res.status(404).json({ error: "Post not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch post" });
  }
});

// ─── POST /api/blog (admin only) ─────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const { title, excerpt, content, image_url, published = true } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: "title and content are required" });
  }

  try {
    const slug = await uniqueSlug(title);
    const { rows } = await pool.query(
      `INSERT INTO blog_posts (title, slug, excerpt, content, image_url, published, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [title, slug, excerpt || null, content, image_url || null, published, req.admin.id],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create post" });
  }
});

// ─── PUT /api/blog/:id (admin only) ──────────────────────────────────────────
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const existing = await pool.query(`SELECT * FROM blog_posts WHERE id = $1`, [
      req.params.id,
    ]);
    if (!existing.rows.length) return res.status(404).json({ error: "Post not found" });

    const current = existing.rows[0];
    const {
      title = current.title,
      excerpt = current.excerpt,
      content = current.content,
      image_url = current.image_url,
      published = current.published,
    } = req.body;

    const slug =
      title !== current.title ? await uniqueSlug(title, current.id) : current.slug;

    const { rows } = await pool.query(
      `UPDATE blog_posts
         SET title = $1, slug = $2, excerpt = $3, content = $4, image_url = $5, published = $6
       WHERE id = $7
       RETURNING *`,
      [title, slug, excerpt, content, image_url, published, req.params.id],
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update post" });
  }
});

// ─── DELETE /api/blog/:id (admin only) ───────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM blog_posts WHERE id = $1`, [
      req.params.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: "Post not found" });
    res.json({ message: "Post deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete post" });
  }
});

module.exports = router;
