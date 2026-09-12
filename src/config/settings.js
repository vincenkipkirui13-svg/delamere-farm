const path = require('node:path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const rootDir = path.resolve(__dirname, '../..');
const storageDir = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : rootDir;
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(storageDir, 'data');
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(storageDir, 'uploads');

module.exports = {
  rootDir,
  storageDir,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  siteName: process.env.SITE_NAME || 'Delamere Farm',
  sessionSecret: process.env.SESSION_SECRET || 'development-only-secret-change-me',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'change-this-password',
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
