const jwt = require("jsonwebtoken");

const COOKIE_NAME = "admin_token";

/**
 * Reads the JWT from the httpOnly cookie (or Authorization header as a
 * fallback for non-browser clients), verifies it, and attaches the
 * decoded admin { id, email, name } to req.admin.
 *
 * Use on any route that should only be reachable by a logged-in admin.
 */
function requireAuth(req, res, next) {
  const headerToken = (req.headers.authorization || "").replace(
    /^Bearer\s+/i,
    "",
  );
  const token = req.cookies?.[COOKIE_NAME] || headerToken;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

module.exports = { requireAuth, COOKIE_NAME };
