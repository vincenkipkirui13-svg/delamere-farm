const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const rootDir = path.resolve(__dirname, '../..');
const isVercel = Boolean(process.env.VERCEL);
// Vercel's deployment filesystem is read-only except for /tmp. This fallback
// allows the app to start there; data stored in /tmp is temporary and not durable.
const storageDir = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : (isVercel ? path.join('/tmp', 'delamere-farm') : rootDir);
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(storageDir, 'data');
const uploadsDir = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(storageDir, 'uploads');
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || (isVercel ? crypto.randomBytes(48).toString('hex') : '');
const adminUsername = String(process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
const adminPassword = String(process.env.ADMIN_PASSWORD || 'Delamere@Admin2026!');

if (isProduction && sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters in production.');
}
if (isProduction && isVercel && !process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not configured in Vercel. Admin sessions may not survive a cold start; set a stable secret in Project Settings > Environment Variables.');
}
if (isProduction && adminPassword.length < 10) {
  throw new Error('ADMIN_PASSWORD must be at least 10 characters in production.');
}

module.exports = {
  rootDir,
  storageDir,
  isProduction,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  siteName: process.env.SITE_NAME || 'Delamere Farm',
  siteUrl: process.env.SITE_URL || 'https://www.delamerefarm.org',
  sessionSecret: sessionSecret || 'development-only-secret-change-me',
  adminUsername,
  adminPassword,
  sitePhone: process.env.SITE_PHONE || '',
  siteEmail: process.env.SITE_EMAIL || '',
  siteLocation: process.env.SITE_LOCATION || '',
  whatsappNumber: process.env.WHATSAPP_NUMBER || '',
  social: {
    facebook: process.env.FACEBOOK_URL || '',
    instagram: process.env.INSTAGRAM_URL || '',
    tiktok: process.env.TIKTOK_URL || ''
  },
  paths: {
    database: path.join(dataDir, 'delamerefarm.db'),
    data: dataDir,
    views: path.join(rootDir, 'views'),
    public: path.join(rootDir, 'public'),
    uploads: uploadsDir,
    siteUploads: path.join(uploadsDir, 'site')
  }
};
