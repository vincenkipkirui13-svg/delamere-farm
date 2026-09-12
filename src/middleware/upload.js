const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const settings = require('../config/settings');

const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

function buildUploader(folder) {
  const destination = path.join(settings.paths.uploads, folder);
  fs.mkdirSync(destination, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destination),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`;
      cb(null, name);
    }
  });

  return multer({
    storage,
    limits: { fileSize: 6 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!allowedMime.has(file.mimetype)) {
        return cb(new Error('Only JPG, PNG, WEBP, and AVIF image files are allowed.'));
      }
      cb(null, true);
    }
  });
}

module.exports = { buildUploader };
