const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const settings = require('../config/settings');

fs.mkdirSync(path.dirname(settings.paths.database), { recursive: true });
const db = new Database(settings.paths.database);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS animals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  breed TEXT,
  age TEXT,
  gender TEXT,
  description TEXT NOT NULL,
  image TEXT,
  availability TEXT NOT NULL DEFAULT 'Available',
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dairy_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  image TEXT,
  availability TEXT NOT NULL DEFAULT 'Available',
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS gallery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  image TEXT NOT NULL,
  description TEXT,
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  inquiry_type TEXT NOT NULL,
  animal_id INTEGER,
  dairy_product_id INTEGER,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'New',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE SET NULL,
  FOREIGN KEY (dairy_product_id) REFERENCES dairy_products(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_animals_category ON animals(category);
CREATE INDEX IF NOT EXISTS idx_animals_featured ON animals(featured);
CREATE INDEX IF NOT EXISTS idx_dairy_featured ON dairy_products(featured);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries(created_at);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 5,
  review_text TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reviews_published ON reviews(published);
CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at);
`);

const setSetting = db.prepare(`INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
function ensureDefault(key, value) {
  if (value !== undefined && value !== null && value !== '' && !db.prepare('SELECT 1 FROM site_settings WHERE key = ?').get(key)) {
    setSetting.run(key, value);
  }
}

ensureDefault('site_name', 'Delamere Farm');

function getSiteSettings() {
  const rows = db.prepare('SELECT key, value FROM site_settings').all();
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return {
    name: values.site_name || settings.siteName || 'Delamere Farm',
    logo: values.logo_image || null,
    icon: values.favicon_image || null,
    heroImage: values.hero_image || null,
    aboutImage: values.about_image || null,
    aboutCaption: values.about_caption || '',
    featureImages: {
      livestock: values.livestock_image || null,
      dairy: values.dairy_image || null,
      experience: values.experience_image || null
    },
    phone: values.contact_phone ?? settings.sitePhone,
    email: values.contact_email ?? settings.siteEmail,
    location: values.contact_location ?? settings.siteLocation,
    whatsapp: values.whatsapp_number ?? settings.whatsappNumber,
    social: {
      facebook: values.facebook_url ?? settings.social.facebook,
      instagram: values.instagram_url ?? settings.social.instagram,
      tiktok: values.tiktok_url ?? settings.social.tiktok
    }
  };
}

module.exports = db;
module.exports.getSiteSettings = getSiteSettings;
module.exports.setSiteSetting = (key, value) => setSetting.run(key, value || null);
