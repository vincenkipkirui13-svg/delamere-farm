const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const settings = require('../config/settings');

fs.mkdirSync(path.dirname(settings.paths.database), { recursive: true });
const db = new Database(settings.paths.database);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

function addColumn(table, column, definition) {
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS animals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'Other',
  breed TEXT,
  age TEXT,
  gender TEXT,
  description TEXT NOT NULL DEFAULT '',
  image TEXT,
  availability TEXT NOT NULL DEFAULT 'Available',
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dairy_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  image TEXT,
  availability TEXT NOT NULL DEFAULT 'Available',
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS gallery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Farm',
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
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 5,
  review_text TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS animal_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  animal_id INTEGER NOT NULL,
  image TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Super Admin',
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_animals_category ON animals(category);
CREATE INDEX IF NOT EXISTS idx_animals_featured ON animals(featured);
CREATE INDEX IF NOT EXISTS idx_dairy_featured ON dairy_products(featured);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries(created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_published ON reviews(published);
CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at);
CREATE INDEX IF NOT EXISTS idx_animal_photos_animal ON animal_photos(animal_id, display_order, id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON admin_activity(created_at);
`);

// Safe, idempotent migrations for projects that already have a database.
[
  ['animals', 'animal_id', 'TEXT'],
  ['animals', 'date_of_birth', 'TEXT'],
  ['animals', 'sex', 'TEXT'],
  ['animals', 'price_range', 'TEXT'],
  ['animals', 'health_information', 'TEXT'],
  ['animals', 'breeding_information', 'TEXT'],
  ['animals', 'production_information', 'TEXT'],
  ['animals', 'display_order', 'INTEGER NOT NULL DEFAULT 0'],
  ['dairy_products', 'category', "TEXT NOT NULL DEFAULT 'Other dairy products'"],
  ['dairy_products', 'price', 'INTEGER'],
  ['dairy_products', 'unit', 'TEXT'],
  ['dairy_products', 'display_order', 'INTEGER NOT NULL DEFAULT 0'],
  ['gallery_items', 'display_order', 'INTEGER NOT NULL DEFAULT 0'],
  ['faqs', 'category', "TEXT NOT NULL DEFAULT 'General'"],
  ['inquiries', 'subject', "TEXT NOT NULL DEFAULT 'Website Inquiry'"],
  ['inquiries', 'updated_at', 'TEXT'],
  ['reviews', 'source', "TEXT NOT NULL DEFAULT 'Admin'"],
].forEach(([table, column, definition]) => addColumn(table, column, definition));

const setSetting = db.prepare(`
  INSERT INTO site_settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

function ensureDefault(key, value) {
  if (value !== undefined && value !== null && value !== '' && !db.prepare('SELECT 1 FROM site_settings WHERE key = ?').get(key)) {
    setSetting.run(key, String(value));
  }
}

const defaults = {
  site_name: 'Delamere Farm',
  site_description: 'Quality livestock and dairy products from Delamere Farm.',
  footer_text: 'A welcoming destination for quality livestock and dairy products, built around clear information, genuine farm imagery, and direct customer communication.',
  copyright_text: '',
  footer_logo_image: '',
  contact_phone: settings.sitePhone,
  contact_email: settings.siteEmail,
  contact_location: settings.siteLocation,
  contact_address: '',
  contact_maps_url: '',
  business_hours: 'Monday - Saturday: 8:00 AM - 5:00 PM',
  whatsapp_number: settings.whatsappNumber,
  whatsapp_message: 'Hello Delamere Farm, I would like to make an inquiry.',
  facebook_url: settings.social.facebook,
  instagram_url: settings.social.instagram,
  tiktok_url: settings.social.tiktok,
  youtube_url: '',
  other_social_url: '',
  hero_title: 'From the farm, with purpose.',
  hero_subtitle: 'Welcome to Delamere Farm',
  hero_description: 'Discover livestock, dairy products and real farm moments in one simple, welcoming place. Browse what is available and contact the farm directly.',
  hero_cta_text: 'Explore Our Livestock',
  hero_cta_link: '/livestock',
  hero_secondary_text: 'Talk to Us',
  hero_secondary_link: '/contact',
  homepage_intro_eyebrow: 'A closer look at the farm',
  homepage_intro_title: 'A digital home designed around the real farm.',
  homepage_intro_description_1: "See what is available, understand the details, and take the next step with confidence. Delamere Farm's online experience keeps the focus on real information, genuine imagery and direct communication.",
  homepage_intro_description_2: 'The content can grow with the farm, from new livestock and dairy products to fresh photography and answers to common customer questions.',
  homepage_intro_link_text: 'Discover our story',
  homepage_explore_eyebrow: 'Explore Delamere Farm',
  homepage_explore_title: 'From livestock to dairy, all in one place.',
  homepage_explore_description: 'Three simple ways to discover more—now built around large, natural photographs instead of decorative icon graphics.',
  homepage_explore_1_title: 'Livestock',
  homepage_explore_1_description: 'Explore cattle and sheep through their classifications, breeds and individual animals.',
  homepage_explore_1_cta: 'Explore Livestock',
  homepage_explore_2_title: 'Dairy Products',
  homepage_explore_2_description: 'Discover dairy offerings with a clear route to ask about availability and details.',
  homepage_explore_2_cta: 'View dairy',
  homepage_explore_3_title: 'Farm Experience',
  homepage_explore_3_description: 'Take a closer visual look at the farm, animals, dairy work and surroundings.',
  homepage_explore_3_cta: 'See the gallery',
  homepage_livestock_eyebrow: 'Featured livestock',
  homepage_livestock_cta_text: 'Explore livestock',
  homepage_dairy_cta_text: 'View dairy',
  homepage_gallery_description: 'Real moments from the farm. As the gallery grows, your own photographs take centre stage here.',
  homepage_benefit_eyebrow: 'The experience',
  homepage_benefit_title: 'Good farming deserves a clear, human customer journey.',
  homepage_benefit_description: 'Real photographs. Useful details. Direct inquiries. Nothing unnecessary.',
  homepage_cta_primary_text: 'Send an Inquiry',
  homepage_cta_secondary_text: 'Browse Livestock',
  homepage_offer_eyebrow: 'What We Offer',
  homepage_offer_title: 'Livestock, dairy and farm services.',
  homepage_offer_description: 'Discover the range of livestock, dairy products, animal feeds and farm services available through Delamere Farm.',
  homepage_livestock_title: 'Selected livestock to explore.',
  homepage_dairy_eyebrow: 'Dairy from the farm',
  homepage_dairy_title: 'Discover the dairy range.',
  homepage_gallery_eyebrow: 'From the farm',
  homepage_gallery_title: 'A glimpse into Delamere Farm.',
  homepage_cta_eyebrow: 'Start a conversation',
  homepage_cta_title: 'Looking for livestock or dairy products?',
  homepage_cta_description: 'Tell us what you are looking for and the Delamere Farm team can guide you on the next step.',
  homepage_featured_animals_limit: '4', homepage_featured_dairy_limit: '4', homepage_gallery_limit: '6',
  homepage_offer_1_title: 'Dairy Cattle', homepage_offer_1_description: 'Friesian/Holstein, Jersey and other pedigree dairy breeds, including calves, heifers and lactating cows.',
  homepage_offer_2_title: 'Dairy Goats', homepage_offer_2_description: 'Saanen and other dairy goats are available for customers and farmers looking for quality dairy breeds.',
  homepage_offer_3_title: 'Sheep & Other Livestock', homepage_offer_3_description: 'Dorper sheep and breeding rams, together with other quality livestock available through the farm.',
  homepage_offer_4_title: 'Animal Feeds', homepage_offer_4_description: 'Animal feeds and practical farm supplies for livestock keepers.',
  homepage_offer_5_title: 'Dairy Products', homepage_offer_5_description: 'Fresh milk, yoghurt, butter and other dairy products from the farm.',
  homepage_offer_6_title: 'Livestock Delivery', homepage_offer_6_description: 'Livestock delivery can be arranged for customers in different parts of Kenya.',
  homepage_offer_7_title: 'Veterinary & Farm Support', homepage_offer_7_description: 'Herd-health advice, farm setup guidance and farmer support.',
  homepage_offer_8_title: 'Farm Visits', homepage_offer_8_description: 'Farm visits are available by appointment for customers who would like to visit the farm.',
  homepage_benefit_1_title: 'Real & visual', homepage_benefit_1_description: 'Use authentic farm photographs to show customers what is actually there.',
  homepage_benefit_2_title: 'Simple to explore', homepage_benefit_2_description: 'Move from an animal or product to a clear inquiry without unnecessary steps.',
  homepage_benefit_3_title: 'Easy to manage', homepage_benefit_3_description: 'Authorized staff can update listings, photographs, FAQs and website branding from the admin area.',
  about_eyebrow: 'Our story',
  about_title: 'Rooted in farming, connected to people.',
  about_lead: 'Delamere Farm is presented through a simple idea: make it easy for customers to discover quality livestock and dairy offerings, then speak directly with the farm.',
  about_intro_eyebrow: 'About the farm',
  about_intro_title: 'Good farming deserves a clear customer experience.',
  about_intro: 'We believe trust starts with clear information. This website is designed to give customers an easy view of our livestock and dairy products while keeping the next step simple: a direct conversation with Delamere Farm.',
  about_story: 'Our digital home can evolve with the farm. New animals, dairy products, photographs, frequently asked questions, and availability can be updated without rebuilding the site.',
  about_mission: '',
  about_vision: '',
  about_values: '',
  about_cta_eyebrow: 'Come closer to the farm',
  about_cta_title: 'Explore what is currently available.',
  about_cta_description: 'Browse our livestock and dairy catalogue or get in touch with the team.',
  about_cta_primary_text: 'Explore Animals',
  about_cta_secondary_text: 'Contact Us',
  livestock_page_eyebrow: 'Livestock',
  livestock_page_title: 'Explore Our Livestock',
  livestock_page_lead: 'Browse livestock by type, classification, breed and individual animal listings.',
  livestock_page_catalog_eyebrow: 'Our catalogue',
  livestock_page_catalog_title: 'Livestock collections',
  livestock_page_catalog_description: 'Start with a livestock type, then explore its classifications and breeds.',
  animals_page_eyebrow: 'Our Farm',
  animals_page_title: 'Livestock',
  animals_page_lead: 'Explore individual animals currently presented by Delamere Farm.',
  dairy_page_eyebrow: 'From Our Farm',
  dairy_page_title: 'Our Products',
  dairy_page_lead: 'Explore the products available from Delamere Farm.',
  gallery_page_eyebrow: 'Visual stories',
  gallery_page_title: 'Farm Gallery',
  gallery_page_lead: 'A glimpse into the farm, our livestock, dairy work and surroundings.',
  faq_page_eyebrow: 'Need to know',
  faq_page_title: 'Frequently Asked Questions',
  faq_page_lead: 'Helpful answers for customers exploring Delamere Farm online.',
  faq_cta_eyebrow: 'Still have a question?',
  faq_cta_title: 'Send us your inquiry.',
  faq_cta_description: 'The Delamere Farm team can help with animals, our products, and availability.',
  faq_cta_button_text: 'Contact Delamere Farm',
  contact_page_eyebrow: 'Get in touch',
  contact_page_title: 'Talk to Delamere Farm',
  contact_page_lead: 'Tell us what you are looking for and include a few details so the team can respond appropriately.',
  contact_section_eyebrow: 'Contact details',
  contact_section_title: 'Let’s start a conversation.',
  contact_section_description: 'Use the form to send an inquiry. Required fields keep the process simple: your name, phone number, inquiry type, and a few useful details.',
  contact_section_note: 'For the quickest response, include the animal or product you are asking about when relevant.',
  seo_home_title: 'Quality Livestock & Dairy',
  seo_home_description: 'Discover quality livestock and dairy products from Delamere Farm.',
  seo_livestock_title: 'Livestock',
  seo_livestock_description: 'Explore Delamere Farm livestock by type, classification, breed, and individual animal.',
  seo_about_title: 'About Delamere Farm',
  seo_gallery_title: 'Farm Gallery',
  seo_contact_title: 'Contact Delamere Farm',
  seo_keywords: '',
  seo_robots: 'index,follow',
  seo_social_image: '',
  primary_color: '#143a29',
  secondary_color: '#d8b26e',
  accent_color: '#b7792b',
  button_style: 'rounded',
  show_whatsapp: '1',
  show_social_icons: '1',
  nav_items: JSON.stringify([
    { label: 'Home', path: '/', visible: true },
    { label: 'About', path: '/about', visible: true },
    { label: 'Livestock', path: '/livestock', visible: true },
    { label: 'Dairy Products', path: '/dairy', visible: true },
    { label: 'Gallery', path: '/gallery', visible: true },
    { label: 'FAQs', path: '/faq', visible: true },
    { label: 'Contact', path: '/contact', visible: true }
  ]),
  footer_quick_links: JSON.stringify([
    { label: 'About Us', path: '/about' },
    { label: 'Our Animals', path: '/animals' },
    { label: 'Dairy Products', path: '/dairy' },
    { label: 'Gallery', path: '/gallery' },
    { label: 'FAQs', path: '/faq' },
    { label: 'Contact', path: '/contact' }
  ]),
};
Object.entries(defaults).forEach(([key, value]) => ensureDefault(key, value));

// One-time deterministic admin bootstrap. This repairs packaged/local/Railway databases
// whose existing administrator credentials are unknown, while preserving all other users.
const bootstrapAdminUsername = 'admin';
const bootstrapAdminPassword = 'Delamere@Admin2026!';
const bootstrapKey = 'admin_bootstrap_v4';
const bootstrapDone = db.prepare('SELECT value FROM site_settings WHERE key=?').get(bootstrapKey);
if (!bootstrapDone) {
  const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE username=? LIMIT 1').get(bootstrapAdminUsername);
  const firstAdmin = db.prepare('SELECT id FROM admin_users ORDER BY id LIMIT 1').get();
  const bootstrapHash = bcrypt.hashSync(bootstrapAdminPassword, 12);

  if (existingAdmin) {
    db.prepare('UPDATE admin_users SET password_hash=?, role=?, active=1 WHERE id=?')
      .run(bootstrapHash, 'Super Admin', existingAdmin.id);
  } else if (firstAdmin) {
    db.prepare('UPDATE admin_users SET username=?, password_hash=?, role=?, active=1 WHERE id=?')
      .run(bootstrapAdminUsername, bootstrapHash, 'Super Admin', firstAdmin.id);
  } else {
    db.prepare('INSERT INTO admin_users (username, password_hash, role, active) VALUES (?, ?, ?, 1)')
      .run(bootstrapAdminUsername, bootstrapHash, 'Super Admin');
  }

  db.prepare('INSERT INTO site_settings (key,value) VALUES (?,?)').run(bootstrapKey, 'completed');
}

function getSiteSettings() {
  const rows = db.prepare('SELECT key, value FROM site_settings').all();
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  let navItems = [];
  let footerLinks = [];
  try { navItems = JSON.parse(values.nav_items || '[]'); } catch { navItems = []; }
  try { footerLinks = JSON.parse(values.footer_quick_links || '[]'); } catch { footerLinks = []; }
  if (!Array.isArray(navItems) || !navItems.length) { navItems = JSON.parse(defaults.nav_items); }
  if (!Array.isArray(footerLinks) || !footerLinks.length) { footerLinks = JSON.parse(defaults.footer_quick_links); }
  return {
    ...values,
    name: values.site_name || settings.siteName || 'Delamere Farm',
    description: values.site_description || '',
    logo: values.logo_image || null,
    footerLogo: values.footer_logo_image || null,
    icon: values.favicon_image || null,
    heroImage: values.hero_image || null,
    heroTitle: values.hero_title || 'From the farm, with purpose.',
    heroSubtitle: values.hero_subtitle || 'Welcome to Delamere Farm',
    heroDescription: values.hero_description || '',
    heroCtaText: values.hero_cta_text || 'Explore Our Livestock',
    heroCtaLink: values.hero_cta_link || '/livestock',
    heroSecondaryText: values.hero_secondary_text || 'Talk to Us',
    heroSecondaryLink: values.hero_secondary_link || '/contact',
    aboutImage: values.about_image || null,
    aboutImage2: values.about_image_2 || null,
    aboutImage3: values.about_image_3 || null,
    aboutCaption: values.about_caption || '',
    pageContent: {
      aboutCta: { eyebrow: values.about_cta_eyebrow || '', title: values.about_cta_title || '', description: values.about_cta_description || '', primaryText: values.about_cta_primary_text || '', secondaryText: values.about_cta_secondary_text || '' },
      livestock: { eyebrow: values.livestock_page_eyebrow || '', title: values.livestock_page_title || '', lead: values.livestock_page_lead || '', catalogEyebrow: values.livestock_page_catalog_eyebrow || '', catalogTitle: values.livestock_page_catalog_title || '', catalogDescription: values.livestock_page_catalog_description || '' },
      animals: { eyebrow: values.animals_page_eyebrow || '', title: values.animals_page_title || '', lead: values.animals_page_lead || '' },
      dairy: { eyebrow: values.dairy_page_eyebrow || '', title: values.dairy_page_title || '', lead: values.dairy_page_lead || '' },
      gallery: { eyebrow: values.gallery_page_eyebrow || '', title: values.gallery_page_title || '', lead: values.gallery_page_lead || '' },
      faq: { eyebrow: values.faq_page_eyebrow || '', title: values.faq_page_title || '', lead: values.faq_page_lead || '', ctaEyebrow: values.faq_cta_eyebrow || '', ctaTitle: values.faq_cta_title || '', ctaDescription: values.faq_cta_description || '', ctaButtonText: values.faq_cta_button_text || '' },
      contact: { eyebrow: values.contact_page_eyebrow || '', title: values.contact_page_title || '', lead: values.contact_page_lead || '', sectionEyebrow: values.contact_section_eyebrow || '', sectionTitle: values.contact_section_title || '', sectionDescription: values.contact_section_description || '', sectionNote: values.contact_section_note || '' }
    },
    featureImages: {
      livestock: values.livestock_image || null,
      dairy: values.dairy_image || null,
      experience: values.experience_image || null
    },
    phone: values.contact_phone ?? settings.sitePhone,
    email: values.contact_email ?? settings.siteEmail,
    location: values.contact_location ?? settings.siteLocation,
    address: values.contact_address || '',
    mapsUrl: values.contact_maps_url || '',
    businessHours: values.business_hours || '',
    whatsapp: values.whatsapp_number ?? settings.whatsappNumber,
    whatsappMessage: values.whatsapp_message || 'Hello Delamere Farm, I would like to make an inquiry.',
    social: {
      facebook: values.facebook_url ?? settings.social.facebook,
      instagram: values.instagram_url ?? settings.social.instagram,
      tiktok: values.tiktok_url ?? settings.social.tiktok,
      youtube: values.youtube_url || '',
      other: values.other_social_url || ''
    },
    footerText: values.footer_text || '',
    copyrightText: values.copyright_text || '',
    navItems,
    footerLinks,
    seo: {
      keywords: values.seo_keywords || '',
      robots: values.seo_robots || 'index,follow',
      socialImage: values.seo_social_image || ''
    },
    branding: {
      primary: values.primary_color || '#143a29',
      secondary: values.secondary_color || '#d8b26e',
      accent: values.accent_color || '#b7792b',
      buttonStyle: values.button_style || 'rounded'
    },
    showWhatsapp: values.show_whatsapp !== '0',
    showSocialIcons: values.show_social_icons !== '0'
  };
}

function setSiteSetting(key, value) {
  return setSetting.run(key, value === undefined || value === null ? null : String(value));
}

module.exports = db;
module.exports.getSiteSettings = getSiteSettings;
module.exports.setSiteSetting = setSiteSetting;
module.exports.hasColumn = hasColumn;
