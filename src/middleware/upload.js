const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const settings = require('../config/settings');

const allowedMime = new Set([
  'image/jpeg', 'image/jpg', 'image/pjpeg',
  'image/png', 'image/webp', 'image/avif'
]);
const allowedExt = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.avif']);

function extensionForMime(mime) {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/avif') return '.avif';
  if (allowedMime.has(mime)) return '.jpg';
  return '';
}

function detectImageType(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(32);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    const data = header.subarray(0, bytesRead);

    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
    if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
    if (data.length >= 12 && data.subarray(4, 8).toString('ascii') === 'ftyp') {
      const brands = data.subarray(8).toString('ascii');
      if (brands.includes('avif') || brands.includes('avis')) return 'avif';
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function removeUploadFile(file) {
  if (!file?.path) return;
  try {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
  } catch {
    // Ignore cleanup errors; the upload failure remains the important result.
  }
}

function validateUploadedFile(file) {
  if (!file?.path) return 'The uploaded image could not be processed.';
  const detected = detectImageType(file.path);
  if (!detected) {
    removeUploadFile(file);
    return 'The uploaded file is not a valid JPG, PNG, WEBP, or AVIF image.';
  }

  const canonicalExt = detected === 'jpeg' ? '.jpg' : `.${detected}`;
  const currentExt = path.extname(file.filename || '').toLowerCase();
  if (currentExt !== canonicalExt) {
    const nextName = path.basename(file.filename, currentExt) + canonicalExt;
    const nextPath = path.join(path.dirname(file.path), nextName);
    try {
      fs.renameSync(file.path, nextPath);
      file.filename = nextName;
      file.path = nextPath;
    } catch {
      removeUploadFile(file);
      return 'The uploaded image could not be saved.';
    }
  }
  return null;
}

function buildUploader(folder) {
  const destination = path.join(settings.paths.uploads, folder);
  fs.mkdirSync(destination, { recursive: true });
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destination),
    filename: (_req, file, cb) => {
      const originalExt = path.extname(file.originalname).toLowerCase();
      const mime = String(file.mimetype || '').toLowerCase();
      const ext = allowedExt.has(originalExt) ? (originalExt === '.jfif' ? '.jpg' : originalExt) : extensionForMime(mime);
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    }
  });

  return multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024, files: 20, fields: 1000, parts: 1025 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const mime = String(file.mimetype || '').toLowerCase();

      // Accept supported image MIME types even when a camera/browser supplies a
      // non-standard filename extension. For unknown/octet-stream uploads,
      // require one of the supported extensions.
      const mimeAllowed = allowedMime.has(mime);
      const extensionAllowed = allowedExt.has(ext);
      const octetStreamAllowed = mime === '' || mime === 'application/octet-stream';

      if ((!mimeAllowed && !extensionAllowed) || (!mimeAllowed && !octetStreamAllowed)) {
        return cb(new Error('Only JPG, PNG, WEBP, and AVIF image files are allowed.'));
      }
      cb(null, true);
    }
  });
}

function validateUploadedFiles(files) {
  for (const file of files || []) {
    const error = validateUploadedFile(file);
    if (error) {
      for (const remaining of files || []) removeUploadFile(remaining);
      return error;
    }
  }
  return null;
}

module.exports = { buildUploader, validateUploadedFile, validateUploadedFiles };
