
CREATE TABLE IF NOT EXISTS donors (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255)        NOT NULL,
  contact_number VARCHAR(20)        NOT NULL,
  blood_group   VARCHAR(5)          NOT NULL CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  can_donate    BOOLEAN             NOT NULL DEFAULT TRUE,
  is_available  BOOLEAN             NOT NULL DEFAULT TRUE,
  cooldown_until TIMESTAMPTZ        NULL,        -- NULL means no active cooldown
  created_at    TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS donors_updated_at ON donors;
CREATE TRIGGER donors_updated_at
  BEFORE UPDATE ON donors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed some sample data
INSERT INTO donors (name, contact_number, blood_group, can_donate, is_available) VALUES
  ('Ayesha Siddiqui',  '+92-300-1234567', 'O+',  TRUE,  TRUE),
  ('Bilal Raza',       '+92-321-9876543', 'A+',  TRUE,  TRUE),
  ('Fatima Noor',      '+92-333-4561234', 'B-',  FALSE, FALSE),
  ('Hassan Mirza',     '+92-345-7891234', 'AB+', TRUE,  TRUE),
  ('Zainab Akhtar',    '+92-312-3214567', 'O-',  TRUE,  TRUE)
ON CONFLICT DO NOTHING;

-- Set a cooldown for the third donor (60 days from now minus 45 days = 15 days remaining)
UPDATE donors
SET    cooldown_until = NOW() + INTERVAL '15 days',
       can_donate     = FALSE,
       is_available   = FALSE
WHERE  name = 'Fatima Noor';

-- ─── Admin users (dashboard auth) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255)  NOT NULL,
  email         VARCHAR(255)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Blog posts ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blog_posts (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(500)  NOT NULL,
  slug          VARCHAR(500)  NOT NULL UNIQUE,
  excerpt       TEXT          NULL,
  content       TEXT          NOT NULL,
  image_url     TEXT          NULL,
  published     BOOLEAN       NOT NULL DEFAULT TRUE,
  author_id     INTEGER       NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS blog_posts_updated_at ON blog_posts;
CREATE TRIGGER blog_posts_updated_at
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- ─── Page content (CMS) ──────────────────────────────────────────────────────
-- Each row = one named section (hero, about, approach, cta, footer)
-- with content stored per language as JSONB blobs.
CREATE TABLE IF NOT EXISTS page_content (
  id          SERIAL PRIMARY KEY,
  section     VARCHAR(50)  NOT NULL UNIQUE,   -- 'hero' | 'about' | 'approach' | 'cta' | 'footer'
  content_en  JSONB        NOT NULL DEFAULT '{}',
  content_ur  JSONB        NOT NULL DEFAULT '{}',
  content_fa  JSONB        NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed default English content for each section
INSERT INTO page_content (section, content_en) VALUES
('hero', '{
  "badge": "Blood Support Network",
  "urgentBanner": "Blood shortages affect hospitals daily — donate today and save a life. Every type needed.",
  "headline": "Making Blood Accessible When It Matters Most",
  "body": "Our mission is to connect donors, hospitals, and patients through a reliable network that delivers life-saving blood support quickly and safely.",
  "primaryBtn": "Become a Donor",
  "secondaryBtn": "Request Support",
  "nav": ["About", "Events", "Get involved"]
}'::jsonb),
('about', '{
  "headline": "Join us in our mission to connect donors and save lives through compassionate giving.",
  "missionBtn": "Our why and mission",
  "storyTitle": "Our story",
  "para1": "Al Qaym Aid is a nonprofit organization dedicated to connecting blood donors with patients in need, ensuring that life-saving blood is available when it matters most.",
  "para2": "We believe that a single act of generosity can make the difference between hope and despair for individuals and families facing medical emergencies. Our mission is to build a strong, reliable network of voluntary blood donors and provide timely assistance to hospitals, patients, and healthcare providers.",
  "para3": "Whether responding to urgent requests, supporting routine medical treatments, or raising awareness about the importance of blood donation, Al Qaym is committed to serving the community with care, integrity, and compassion. Every donation has the power to save lives — through community engagement, donor outreach, and a shared commitment to helping others, we work to ensure that no patient is left without the blood they need."
}'::jsonb),
('approach', '{
  "title": "How it works",
  "intro": "Donating blood through Al Qaym is simple, fast, and built on trust. From the moment a request comes in to the moment a donation reaches a patient, every step is designed to save time when it matters most.",
  "steps": [
    {"number": "01", "title": "Request or Register", "description": "Patients request blood instantly, and donors join our verified network."},
    {"number": "02", "title": "Smart Matching", "description": "We quickly match blood type, location, and urgency with available donors."},
    {"number": "03", "title": "Life-Saving Donation", "description": "We coordinate directly with donors and hospitals to ensure safe and timely support."}
  ]
}'::jsonb),
('cta', '{
  "eyebrow": "Voluntary Blood Donation",
  "headline": "Every drop keeps a life going.",
  "body": "Join our network of voluntary donors and help us reach patients exactly when — and where — they need it most.",
  "primaryBtn": "Register to donate",
  "secondaryBtn": "How it works"
}'::jsonb),
('footer', '{
  "columns": [
    {"heading": "About", "links": ["Our why and mission", "Board of Directors", "News"]},
    {"heading": "Donate blood", "links": ["Find a blood drive", "Check eligibility", "Donation process", "Host a drive"]},
    {"heading": "Get involved", "links": ["Request blood", "Make a monetary gift", "Volunteering", "Become a member"]},
    {"heading": "More", "links": ["Ask for help", "Partner with us", "Contact us"]}
  ],
  "social": ["Facebook", "Instagram"],
  "credit": "Site by Mohammad Agha"
}'::jsonb),
('contact', '{
  "phone": "+92 300 0000000",
  "whatsapp": "+923000000000",
  "email": "hello@alqayimaid.org",
  "address": "Brewery Town, Quetta, Pakistan",
  "responseTime": "Within 24 hours, daily"
}'::jsonb)
ON CONFLICT (section) DO NOTHING;

-- ─── Contact / donation enquiry submissions ─────────────────────────────────
-- Public visitors submit these via the /contact page (general questions,
-- donation offers, blood requests, partnership/volunteer enquiries).
CREATE TABLE IF NOT EXISTS contact_messages (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255)  NOT NULL,
  email         VARCHAR(255)  NOT NULL,
  phone         VARCHAR(30)   NULL,
  reason        VARCHAR(30)   NOT NULL DEFAULT 'general'
                  CHECK (reason IN ('general','donate','request-blood','partnership','volunteer')),
  blood_group   VARCHAR(5)    NULL
                  CHECK (blood_group IS NULL OR blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  message       TEXT          NOT NULL,
  status        VARCHAR(20)   NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new','read','resolved')),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
