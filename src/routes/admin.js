const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');
const livestock = require('../db/livestock');
const db = require('../db/database');
const settings = require('../config/settings');
const slugify = require('../utils/slugify');
const { requireAuth, requireRole, requireSuperAdmin } = require('../middleware/auth');
const { buildUploader, validateUploadedFile, validateUploadedFiles } = require('../middleware/upload');

const router = express.Router();
const imageUpload = buildUploader('animals');
const livestockUpload = buildUploader('livestock');
const dairyUpload = buildUploader('dairy');
const galleryUpload = buildUploader('gallery');
const siteUpload = buildUploader('site');
const loginFailures = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const ADMIN_ROLES = ['Super Admin', 'Content Manager', 'Livestock Manager', 'Inquiry Manager'];
const ADMIN_USERNAME_PATTERN = /^[a-zA-Z0-9._%+@-]{3,120}$/;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

const contentEditor = requireRole('Super Admin', 'Content Manager');
const livestockEditor = requireRole('Super Admin', 'Livestock Manager');
const inquiryManager = requireRole('Super Admin', 'Inquiry Manager');

function loginBlocked(ip) {
  const item = loginFailures.get(ip);
  if (!item) return false;
  if (Date.now() - item.startedAt > LOGIN_WINDOW_MS) {
    loginFailures.delete(ip);
    return false;
  }
  return item.count >= LOGIN_MAX_FAILURES;
}

function noteLoginFailure(ip) {
  const now = Date.now();
  const item = loginFailures.get(ip);
  if (!item || now - item.startedAt > LOGIN_WINDOW_MS) loginFailures.set(ip, { count: 1, startedAt: now });
  else item.count += 1;
}

function clearLoginFailures(ip) {
  loginFailures.delete(ip);
}

function safeText(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function bool(value) {
  return value === 'on' || value === '1' || value === 'true' ? 1 : 0;
}

function int(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isSafeInteger(n) ? n : fallback;
}

function safeUrl(value) {
  const v = safeText(value, 500);
  return !v || /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(v) ? v : '';
}

function safeColor(value, fallback) {
  const v = safeText(value, 20);
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback;
}

function removeUpload(relativePath) {
  if (!relativePath) return;
  const root = path.resolve(settings.paths.uploads);
  const filePath = path.resolve(root, relativePath);
  if ((filePath === root || filePath.startsWith(`${root}${path.sep}`)) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function logActivity(req, action, entityType = null, entityId = null) {
  if (!req.session?.admin?.id) return;
  try {
    db.prepare('INSERT INTO admin_activity (admin_user_id,action,entity_type,entity_id,ip_address) VALUES (?,?,?,?,?)')
      .run(req.session.admin.id, action, entityType, entityId, req.ip);
  } catch (error) {
    console.error('Activity log failed:', error.message);
  }
}

function renderForm(res, view, locals, status = 400) {
  return res.status(status).render(view, locals);
}

function parseMulti(value) {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map(Number)
    .filter(Number.isSafeInteger);
}

function getAnimal(id) {
  return db.prepare('SELECT * FROM animals WHERE id=?').get(id);
}

function getProduct(id) {
  return db.prepare('SELECT * FROM dairy_products WHERE id=?').get(id);
}

function uploadSingle(uploader, field) {
  return (req, res, next) => uploader.single(field)(req, res, error => {
    if (error) {
      req.uploadError = error.message || 'The uploaded image could not be processed.';
      return next();
    }
    const validationError = validateUploadedFile(req.file);
    if (validationError) req.uploadError = validationError;
    next();
  });
}

function uploadArray(uploader, field, maxCount) {
  return (req, res, next) => uploader.array(field, maxCount)(req, res, error => {
    if (error) {
      req.uploadError = error.message || 'The uploaded images could not be processed.';
      return next();
    }
    const validationError = validateUploadedFiles(req.files);
    if (validationError) req.uploadError = validationError;
    next();
  });
}

function uploadFields(uploader, fields) {
  return (req, res, next) => uploader.fields(fields)(req, res, error => {
    if (error) {
      req.uploadError = error.message || 'The uploaded images could not be processed.';
      return next();
    }
    const files = Object.values(req.files || {}).flat();
    const validationError = validateUploadedFiles(files);
    if (validationError) req.uploadError = validationError;
    next();
  });
}

function removeUploadedFiles(files, folder) {
  for (const fileList of Object.values(files || {})) {
    for (const file of fileList || []) {
      if (file?.filename) removeUpload(`${folder}/${file.filename}`);
    }
  }
}

function listAdmins() {
  return db.prepare('SELECT id,username,role,active,last_login_at,created_at FROM admin_users ORDER BY username').all();
}

function adminUsersLocals(error = null, success = null) {
  return { title: 'Admin Users', users: listAdmins(), error, success };
}

function activeSuperAdminCount(excludingId = null) {
  if (excludingId === null) return db.prepare("SELECT COUNT(*) count FROM admin_users WHERE active=1 AND role='Super Admin'").get().count;
  return db.prepare("SELECT COUNT(*) count FROM admin_users WHERE active=1 AND role='Super Admin' AND id!=?").get(excludingId).count;
}

function revokeUserSessions(userId) {
  const rows = db.prepare('SELECT sid,data FROM sessions').all();
  const remove = db.prepare('DELETE FROM sessions WHERE sid=?');
  const tx = db.transaction(() => {
    for (const row of rows) {
      try {
        const data = JSON.parse(row.data);
        if (Number(data.admin?.id) === Number(userId)) remove.run(row.sid);
      } catch {
        // Ignore malformed/expired session records; cleanup can happen naturally.
      }
    }
  });
  tx();
}

router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Staff Login', error: null });
});

router.post('/login', async (req, res) => {
  const suppliedCsrf = String(req.body?._csrf || req.get('x-csrf-token') || '');
  if (!suppliedCsrf || suppliedCsrf !== req.session?.csrfToken) {
    return res.status(403).render('admin/login', { title: 'Staff Login', error: 'Your session security token is missing or expired. Refresh the login page and try again.' });
  }
  const ip = req.ip;
  if (loginBlocked(ip)) return res.status(429).render('admin/login', { title: 'Staff Login', error: 'Too many failed attempts. Please wait 15 minutes and try again.' });
  const username = safeText(req.body.username, 120);
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM admin_users WHERE username=? AND active=1').get(username);
  const matches = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!matches) {
    noteLoginFailure(ip);
    return res.status(401).render('admin/login', { title: 'Staff Login', error: 'Invalid username or password.' });
  }
  clearLoginFailures(ip);
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.admin = { id: user.id, username: user.username, role: user.role };
  db.prepare('UPDATE admin_users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?').run(user.id);
  logActivity(req, 'Logged in', 'Admin User', user.id);
  return res.redirect('/admin');
});

router.use(requireAuth);
function validateCsrf(req, res, next) {
  const supplied = String(req.body?._csrf || req.get('x-csrf-token') || '');
  if (!supplied || supplied !== req.session.csrfToken) {
    return res.status(403).render('admin/error', { title: 'Request Blocked', errorMessage: 'Your session security token is missing or expired. Refresh the page and try again.' });
  }
  next();
}

function validateMultipartCsrf(req, res, next) {
  const supplied = String(req.body?._csrf || req.get('x-csrf-token') || '');
  if (!supplied || supplied !== req.session.csrfToken) {
    if (req.file?.filename) removeUpload(req.file.path || req.file.filename);
    return res.status(403).render('admin/error', { title: 'Request Blocked', errorMessage: 'Your session security token is missing or expired. Refresh the page and try again.' });
  }
  next();
}

router.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  // Multipart/form-data is parsed by multer on the individual upload routes.
  // Those routes validate CSRF immediately after multer has populated req.body.
  if (req.is('multipart/form-data')) return next();
  return validateCsrf(req, res, next);
});

router.post('/logout', (req, res) => {
  logActivity(req, 'Logged out', 'Admin User', req.session.admin.id);
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ---------------- Dashboard ----------------
router.get('/', (req, res) => {
  const stats = {
    breeds: db.prepare('SELECT COUNT(*) count FROM livestock_breeds').get().count,
    animals: db.prepare('SELECT COUNT(*) count FROM animals').get().count,
    dairy: db.prepare('SELECT COUNT(*) count FROM dairy_products').get().count,
    gallery: db.prepare('SELECT COUNT(*) count FROM gallery_items').get().count,
    faqs: db.prepare('SELECT COUNT(*) count FROM faqs').get().count,
    reviews: db.prepare('SELECT COUNT(*) count FROM reviews').get().count,
    inquiries: db.prepare('SELECT COUNT(*) count FROM inquiries').get().count,
    newInquiries: db.prepare("SELECT COUNT(*) count FROM inquiries WHERE status='New'").get().count
  };
  const latestInquiries = db.prepare(`
    SELECT i.*,a.name animal_name,d.name product_name
    FROM inquiries i
    LEFT JOIN animals a ON a.id=i.animal_id
    LEFT JOIN dairy_products d ON d.id=i.dairy_product_id
    ORDER BY i.created_at DESC LIMIT 6
  `).all();
  const recentAnimals = db.prepare(`
    SELECT a.*, b.name breed_name
    FROM animals a LEFT JOIN livestock_breeds b ON b.id=a.breed_id
    ORDER BY a.created_at DESC LIMIT 5
  `).all();
  const recentGallery = db.prepare('SELECT * FROM gallery_items ORDER BY created_at DESC LIMIT 5').all();
  res.render('admin/dashboard', { title: 'Admin Dashboard', stats, latestInquiries, recentAnimals, recentGallery });
});

// ---------------- Livestock ----------------
router.get('/animals', livestockEditor, (_req, res) => {
  const animals = db.prepare(`
    SELECT a.*,b.name breed_name,t.name livestock_type_name,c.name livestock_classification_name
    FROM animals a
    LEFT JOIN livestock_breeds b ON b.id=a.breed_id
    LEFT JOIN livestock_types t ON t.name=a.livestock_type
    LEFT JOIN livestock_classifications c ON c.name=a.livestock_classification AND c.livestock_type_id=t.id
    ORDER BY a.featured DESC,a.display_order,a.created_at DESC
  `).all();
  res.render('admin/animals', { title: 'Individual Animals', animals });
});

router.get('/breeds', livestockEditor, (_req, res) => {
  const breeds = db.prepare(`
    SELECT b.*,t.name livestock_type_name,GROUP_CONCAT(c.name, ', ') classifications
    FROM livestock_breeds b
    JOIN livestock_types t ON t.id=b.livestock_type_id
    LEFT JOIN livestock_breed_classifications bc ON bc.breed_id=b.id
    LEFT JOIN livestock_classifications c ON c.id=bc.classification_id
    GROUP BY b.id ORDER BY t.display_order,b.featured DESC,b.display_order,b.name
  `).all();
  res.render('admin/breeds', { title: 'Breed Library', breeds });
});

function animalFormLocals(title, animal, error = null) {
  return { title, animal, error, types: livestock.getTypes(), classifications: livestock.getAllClassifications(), breedOptions: livestock.getAllBreeds() };
}

router.get('/animals/new', livestockEditor, (_req, res) => res.render('admin/animal-form', animalFormLocals('Add Animal', null)));

function animalPayload(body, existing = null) {
  const priceInput = safeText(body.price, 30);
  const price = priceInput === '' ? null : Number.parseInt(priceInput, 10);
  if (price !== null && (!Number.isSafeInteger(price) || price < 0)) throw new Error('Price must be a valid non-negative whole number.');
  const breedId = int(body.breed_id, 0) || null;
  const breedRecord = breedId
    ? db.prepare('SELECT b.*,t.name type_name FROM livestock_breeds b JOIN livestock_types t ON t.id=b.livestock_type_id WHERE b.id=?').get(breedId)
    : null;
  const requestedType = safeText(body.livestock_type, 60);
  const requestedClassification = safeText(body.livestock_classification, 100);
  const selectedType = breedRecord?.type_name || requestedType || existing?.livestock_type || '';
  const classification = requestedClassification
    ? db.prepare('SELECT c.* FROM livestock_classifications c JOIN livestock_types t ON t.id=c.livestock_type_id WHERE t.name=? AND c.name=?').get(selectedType, requestedClassification)
    : null;
  if (requestedClassification && !classification) throw new Error('Please choose a valid classification for the selected livestock type/breed.');
  const name = safeText(body.name, 100);
  if (!name) throw new Error('Animal name is required.');
  const description = safeText(body.description, 2000);
  if (!description) throw new Error('Description is required.');
  return {
    name,
    slug: existing?.slug || slugify(body.slug || name),
    category: safeText(body.category, 60) || 'Other',
    breed: breedRecord?.name || safeText(body.breed, 100) || null,
    age: safeText(body.age, 40) || null,
    gender: safeText(body.gender, 30) || safeText(body.sex, 30) || existing?.gender || null,
    sex: safeText(body.sex, 30) || safeText(body.gender, 30) || existing?.sex || existing?.gender || null,
    description,
    availability: ['Available', 'On Request', 'Sold'].includes(body.availability) ? body.availability : 'Available',
    featured: bool(body.featured),
    livestock_type: breedRecord?.type_name || requestedType || existing?.livestock_type || null,
    livestock_classification: classification?.name || safeText(body.livestock_classification, 100) || existing?.livestock_classification || null,
    breed_id: breedRecord?.id || null,
    price,
    price_range: safeText(body.price_range, 100) || null,
    display_order: Math.max(0, int(body.display_order, 0))
  };
}

router.post('/animals', livestockEditor, uploadSingle(imageUpload, 'image'), validateMultipartCsrf, (req, res) => {
  let payload;
  try {
    payload = animalPayload(req.body);
  } catch (error) {
    removeUpload(req.file && `animals/${req.file.filename}`);
    return renderForm(res, 'admin/animal-form', animalFormLocals('Add Animal', { ...req.body, image: null }, error.message));
  }
  if (req.uploadError) {
    removeUpload(req.file && `animals/${req.file.filename}`);
    return renderForm(res, 'admin/animal-form', animalFormLocals('Add Animal', { ...req.body, image: null }, req.uploadError));
  }
  const image = req.file ? `animals/${req.file.filename}` : null;
  try {
    const result = db.prepare(`INSERT INTO animals (name,slug,category,breed,age,gender,description,image,availability,featured,livestock_type,livestock_classification,breed_id,price,sex,price_range,display_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(payload.name, payload.slug, payload.category, payload.breed, payload.age, payload.gender, payload.description, image, payload.availability, payload.featured, payload.livestock_type, payload.livestock_classification, payload.breed_id, payload.price, payload.sex, payload.price_range, payload.display_order);
    logActivity(req, 'Created animal', 'Animal', result.lastInsertRowid);
    return res.redirect('/admin/animals');
  } catch (error) {
    removeUpload(image);
    return renderForm(res, 'admin/animal-form', animalFormLocals('Add Animal', { ...req.body, image: null }, error.message.includes('UNIQUE') ? 'That slug is already in use.' : 'Unable to save animal.'));
  }
});

router.get('/animals/:id/edit', livestockEditor, (req, res) => {
  const animal = getAnimal(req.params.id);
  if (!animal) return res.redirect('/admin/animals');
  const photos = db.prepare('SELECT * FROM animal_photos WHERE animal_id=? ORDER BY display_order,id').all(animal.id);
  res.render('admin/animal-form', { ...animalFormLocals('Edit Animal', animal), photos });
});

router.post('/animals/:id', livestockEditor, uploadSingle(imageUpload, 'image'), validateMultipartCsrf, (req, res) => {
  const existing = getAnimal(req.params.id);
  if (!existing) {
    removeUpload(req.file && `animals/${req.file.filename}`);
    return res.redirect('/admin/animals');
  }
  let payload;
  try {
    payload = animalPayload(req.body, existing);
  } catch (error) {
    removeUpload(req.file && `animals/${req.file.filename}`);
    return renderForm(res, 'admin/animal-form', animalFormLocals('Edit Animal', { ...existing, ...req.body, image: existing.image }, error.message));
  }
  if (req.uploadError) {
    removeUpload(req.file && `animals/${req.file.filename}`);
    return renderForm(res, 'admin/animal-form', animalFormLocals('Edit Animal', { ...existing, ...req.body, image: existing.image }, req.uploadError));
  }
  const image = req.file ? `animals/${req.file.filename}` : existing.image;
  try {
    db.prepare(`UPDATE animals SET name=?,slug=?,category=?,breed=?,age=?,gender=?,description=?,image=?,availability=?,featured=?,livestock_type=?,livestock_classification=?,breed_id=?,price=?,sex=?,price_range=?,display_order=? WHERE id=?`)
      .run(payload.name, payload.slug, payload.category, payload.breed, payload.age, payload.gender, payload.description, image, payload.availability, payload.featured, payload.livestock_type, payload.livestock_classification, payload.breed_id, payload.price, payload.sex, payload.price_range, payload.display_order, existing.id);
    if (req.file) removeUpload(existing.image);
    logActivity(req, 'Updated animal', 'Animal', existing.id);
    return res.redirect('/admin/animals');
  } catch (error) {
    if (req.file) removeUpload(`animals/${req.file.filename}`);
    return renderForm(res, 'admin/animal-form', animalFormLocals('Edit Animal', { ...existing, ...req.body, image: existing.image }, error.message.includes('UNIQUE') ? 'That slug is already in use.' : 'Unable to update animal.'));
  }
});

router.post('/animals/:id/delete', livestockEditor, (req, res) => {
  const animal = getAnimal(req.params.id);
  if (!animal) return res.redirect('/admin/animals');
  const photos = db.prepare('SELECT image FROM animal_photos WHERE animal_id=?').all(req.params.id);
  db.transaction(() => {
    db.prepare('DELETE FROM animals WHERE id=?').run(req.params.id);
  })();
  removeUpload(animal.image);
  photos.forEach(photo => removeUpload(photo.image));
  logActivity(req, 'Deleted animal', 'Animal', req.params.id);
  res.redirect('/admin/animals');
});

router.post('/animals/:id/photos', livestockEditor, uploadArray(imageUpload, 'images', 12), (req, res) => {
  const animal = getAnimal(req.params.id);
  if (!animal) {
    (req.files || []).forEach(file => removeUpload(`animals/${file.filename}`));
    return res.redirect('/admin/animals');
  }
  if (req.uploadError) {
    (req.files || []).forEach(file => removeUpload(`animals/${file.filename}`));
    return res.status(400).redirect(`/admin/animals/${animal.id}/edit`);
  }
  const next = db.prepare('SELECT COALESCE(MAX(display_order),-1)+1 n FROM animal_photos WHERE animal_id=?').get(animal.id).n;
  const insert = db.prepare('INSERT INTO animal_photos (animal_id,image,display_order) VALUES (?,?,?)');
  try {
    db.transaction(() => {
      (req.files || []).forEach((file, index) => insert.run(animal.id, `animals/${file.filename}`, next + index));
    })();
  } catch (error) {
    (req.files || []).forEach(file => removeUpload(`animals/${file.filename}`));
    return res.status(400).redirect(`/admin/animals/${animal.id}/edit`);
  }
  logActivity(req, 'Added animal photographs', 'Animal', animal.id);
  res.redirect(`/admin/animals/${animal.id}/edit`);
});

router.post('/animals/:animalId/photos/:photoId/delete', livestockEditor, (req, res) => {
  const photo = db.prepare('SELECT * FROM animal_photos WHERE id=? AND animal_id=?').get(req.params.photoId, req.params.animalId);
  if (photo) {
    db.prepare('DELETE FROM animal_photos WHERE id=?').run(photo.id);
    removeUpload(photo.image);
    logActivity(req, 'Deleted animal photograph', 'Animal', photo.animal_id);
  }
  res.redirect(`/admin/animals/${req.params.animalId}/edit`);
});

// Taxonomy / Breed Library
router.get('/livestock', livestockEditor, (_req, res) => res.redirect('/admin/taxonomy'));
router.get('/taxonomy', livestockEditor, (_req, res) => res.render('admin/taxonomy', { title: 'Livestock Categories & Classifications', types: livestock.getTypes(), classifications: livestock.getAllClassifications() }));

router.post('/livestock-types', livestockEditor, (req, res) => {
  const name = safeText(req.body.name, 80);
  if (name) {
    try {
      const result = db.prepare('INSERT INTO livestock_types (name,slug,description,display_order) VALUES (?,?,?,?)')
        .run(name, slugify(name), safeText(req.body.description, 500), Math.max(0, int(req.body.display_order)));
      logActivity(req, 'Created livestock type', 'Livestock Type', result.lastInsertRowid);
    } catch {
      // Keep the admin page usable when a duplicate slug is submitted.
    }
  }
  res.redirect('/admin/taxonomy');
});

router.post('/livestock-types/:id', livestockEditor, (req, res) => {
  const existing = db.prepare('SELECT * FROM livestock_types WHERE id=?').get(req.params.id);
  const name = safeText(req.body.name, 80);
  if (!existing || !name) return res.redirect('/admin/taxonomy');
  try {
    db.transaction(() => {
      db.prepare('UPDATE livestock_types SET name=?,slug=?,description=?,display_order=? WHERE id=?')
        .run(name, slugify(name), safeText(req.body.description, 500), Math.max(0, int(req.body.display_order)), existing.id);
      db.prepare('UPDATE animals SET livestock_type=? WHERE livestock_type=?').run(name, existing.name);
    })();
    logActivity(req, 'Updated livestock type', 'Livestock Type', existing.id);
  } catch {
    // Leave existing data intact when a conflicting slug is submitted.
  }
  res.redirect('/admin/taxonomy');
});

router.post('/livestock-types/:id/delete', livestockEditor, (req, res) => {
  const id = Number(req.params.id);
  const breedCount = db.prepare('SELECT COUNT(*) count FROM livestock_breeds WHERE livestock_type_id=?').get(id).count;
  const animalCount = db.prepare('SELECT COUNT(*) count FROM animals a JOIN livestock_types t ON t.id=? WHERE a.livestock_type=t.name').get(id).count;
  if (breedCount === 0 && animalCount === 0) {
    const row = db.prepare('SELECT image FROM livestock_types WHERE id=?').get(id);
    db.prepare('DELETE FROM livestock_types WHERE id=?').run(id);
    removeUpload(row?.image);
    logActivity(req, 'Deleted livestock type', 'Livestock Type', id);
  }
  res.redirect('/admin/taxonomy');
});

router.post('/livestock-classifications', livestockEditor, (req, res) => {
  const typeId = int(req.body.livestock_type_id);
  const name = safeText(req.body.name, 100);
  if (typeId && name) {
    try {
      const result = db.prepare('INSERT INTO livestock_classifications (livestock_type_id,name,slug,description,display_order) VALUES (?,?,?,?,?)')
        .run(typeId, name, slugify(name), safeText(req.body.description, 500), Math.max(0, int(req.body.display_order)));
      logActivity(req, 'Created livestock classification', 'Classification', result.lastInsertRowid);
    } catch {
      // Keep the admin page usable when a duplicate slug is submitted.
    }
  }
  res.redirect('/admin/taxonomy');
});

router.post('/livestock-classifications/:id', livestockEditor, (req, res) => {
  const existing = db.prepare(`
    SELECT c.*,t.name livestock_type_name
    FROM livestock_classifications c JOIN livestock_types t ON t.id=c.livestock_type_id WHERE c.id=?
  `).get(req.params.id);
  const name = safeText(req.body.name, 100);
  if (!existing || !name) return res.redirect('/admin/taxonomy');
  try {
    db.transaction(() => {
      db.prepare('UPDATE livestock_classifications SET name=?,slug=?,description=?,display_order=? WHERE id=?')
        .run(name, slugify(name), safeText(req.body.description, 500), Math.max(0, int(req.body.display_order)), existing.id);
      db.prepare('UPDATE animals SET livestock_classification=? WHERE livestock_type=? AND livestock_classification=?')
        .run(name, existing.livestock_type_name, existing.name);
    })();
    logActivity(req, 'Updated livestock classification', 'Classification', existing.id);
  } catch {
    // Keep existing taxonomy data intact on conflicts.
  }
  res.redirect('/admin/taxonomy');
});

router.post('/livestock-classifications/:id/delete', livestockEditor, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT c.*,t.name livestock_type_name FROM livestock_classifications c JOIN livestock_types t ON t.id=c.livestock_type_id WHERE c.id=?`).get(id);
  if (!row) return res.redirect('/admin/taxonomy');
  const breedCount = db.prepare('SELECT COUNT(*) count FROM livestock_breed_classifications WHERE classification_id=?').get(id).count;
  const animalCount = db.prepare('SELECT COUNT(*) count FROM animals WHERE livestock_type=? AND livestock_classification=?').get(row.livestock_type_name, row.name).count;
  if (breedCount === 0 && animalCount === 0) {
    db.prepare('DELETE FROM livestock_classifications WHERE id=?').run(id);
    removeUpload(row.image);
    logActivity(req, 'Deleted livestock classification', 'Classification', id);
  }
  res.redirect('/admin/taxonomy');
});

router.get('/animals/breeds/new', livestockEditor, (_req, res) => res.redirect('/admin/breeds/new'));
router.get('/breeds/new', livestockEditor, (_req, res) => res.render('admin/breed-form', { title: 'Add Livestock Breed', breed: null, error: null, types: livestock.getTypes(), classifications: livestock.getAllClassifications() }));

router.post('/breeds', livestockEditor, uploadSingle(livestockUpload, 'image'), validateMultipartCsrf, (req, res) => {
  const type = livestock.getType(slugify(req.body.livestock_type));
  const classIds = parseMulti(req.body.classifications);
  if (!type || !safeText(req.body.name, 120)) {
    removeUpload(req.file && `livestock/${req.file.filename}`);
    return res.status(400).render('admin/breed-form', { title: 'Add Livestock Breed', breed: req.body, error: 'Please choose a valid livestock type and breed name.', types: livestock.getTypes(), classifications: livestock.getAllClassifications() });
  }
  if (req.uploadError) {
    removeUpload(req.file && `livestock/${req.file.filename}`);
    return res.status(400).render('admin/breed-form', { title: 'Add Livestock Breed', breed: req.body, error: req.uploadError, types: livestock.getTypes(), classifications: livestock.getAllClassifications() });
  }
  const image = req.file ? `livestock/${req.file.filename}` : null;
  try {
    const result = db.transaction(() => {
      const insert = db.prepare('INSERT INTO livestock_breeds (livestock_type_id,name,slug,description,image,featured,display_order) VALUES (?,?,?,?,?,?,?)')
        .run(type.id, safeText(req.body.name, 120), slugify(req.body.slug || req.body.name), safeText(req.body.description, 2000), image, bool(req.body.featured), Math.max(0, int(req.body.display_order)));
      const link = db.prepare('INSERT OR IGNORE INTO livestock_breed_classifications (breed_id,classification_id) VALUES (?,?)');
      classIds.forEach(id => {
        const classification = db.prepare('SELECT id FROM livestock_classifications WHERE id=? AND livestock_type_id=?').get(id, type.id);
        if (classification) link.run(result.lastInsertRowid, classification.id);
      });
      return result.lastInsertRowid;
    })();
    logActivity(req, 'Created breed', 'Breed', result);
    res.redirect('/admin/breeds');
  } catch (error) {
    removeUpload(image);
    res.status(400).render('admin/breed-form', { title: 'Add Livestock Breed', breed: req.body, error: error.message.includes('UNIQUE') ? 'That breed already exists for this livestock type.' : 'Unable to save breed.', types: livestock.getTypes(), classifications: livestock.getAllClassifications() });
  }
});

router.get('/breeds/:id/edit', livestockEditor, (req, res) => {
  const breed = db.prepare('SELECT * FROM livestock_breeds WHERE id=?').get(req.params.id);
  if (!breed) return res.redirect('/admin/breeds');
  const type = db.prepare('SELECT * FROM livestock_types WHERE id=?').get(breed.livestock_type_id);
  const selected = db.prepare('SELECT classification_id FROM livestock_breed_classifications WHERE breed_id=?').all(breed.id).map(x => x.classification_id);
  res.render('admin/breed-form', { title: 'Edit Livestock Breed', breed: { ...breed, livestock_type: type?.name || '', classificationIds: selected }, error: null, types: livestock.getTypes(), classifications: livestock.getAllClassifications() });
});

router.post('/breeds/:id', livestockEditor, uploadSingle(livestockUpload, 'image'), validateMultipartCsrf, (req, res) => {
  const existing = db.prepare('SELECT * FROM livestock_breeds WHERE id=?').get(req.params.id);
  if (!existing) {
    removeUpload(req.file && `livestock/${req.file.filename}`);
    return res.redirect('/admin/breeds');
  }
  if (req.uploadError) {
    removeUpload(req.file && `livestock/${req.file.filename}`);
    return res.status(400).redirect(`/admin/breeds/${existing.id}/edit`);
  }
  const name = safeText(req.body.name, 120);
  if (!name) {
    removeUpload(req.file && `livestock/${req.file.filename}`);
    return res.status(400).redirect(`/admin/breeds/${existing.id}/edit`);
  }
  const image = req.file ? `livestock/${req.file.filename}` : existing.image;
  try {
    db.transaction(() => {
      db.prepare('UPDATE livestock_breeds SET name=?,slug=?,description=?,image=?,featured=?,display_order=? WHERE id=?')
        .run(name, slugify(req.body.slug || name), safeText(req.body.description, 2000), image, bool(req.body.featured), Math.max(0, int(req.body.display_order)), existing.id);
      db.prepare('UPDATE animals SET breed=? WHERE breed_id=?').run(name, existing.id);
      db.prepare('DELETE FROM livestock_breed_classifications WHERE breed_id=?').run(existing.id);
      const link = db.prepare('INSERT OR IGNORE INTO livestock_breed_classifications (breed_id,classification_id) VALUES (?,?)');
      parseMulti(req.body.classifications).forEach(id => {
        const classification = db.prepare('SELECT id FROM livestock_classifications WHERE id=? AND livestock_type_id=?').get(id, existing.livestock_type_id);
        if (classification) link.run(existing.id, classification.id);
      });
    })();
    if (req.file) removeUpload(existing.image);
    logActivity(req, 'Updated breed', 'Breed', existing.id);
    res.redirect('/admin/breeds');
  } catch (error) {
    removeUpload(req.file && image);
    res.status(400).redirect(`/admin/breeds/${existing.id}/edit`);
  }
});

router.post('/breeds/:id/delete', livestockEditor, (req, res) => {
  const breed = db.prepare('SELECT image FROM livestock_breeds WHERE id=?').get(req.params.id);
  if (!breed) return res.redirect('/admin/breeds');
  db.transaction(() => {
    db.prepare('UPDATE animals SET breed_id=NULL,breed=NULL WHERE breed_id=?').run(req.params.id);
    db.prepare('DELETE FROM livestock_breeds WHERE id=?').run(req.params.id);
  })();
  removeUpload(breed.image);
  logActivity(req, 'Deleted breed', 'Breed', req.params.id);
  res.redirect('/admin/breeds');
});

// Taxonomy photographs
router.get('/livestock-catalog', livestockEditor, (_req, res) => res.render('admin/livestock-catalog', { title: 'Livestock Collection Photos', types: livestock.getTypes(), classifications: livestock.getAllClassifications() }));
router.post('/livestock-types/:id/photo', livestockEditor, uploadSingle(livestockUpload, 'image'), validateMultipartCsrf, (req, res) => {
  const type = db.prepare('SELECT * FROM livestock_types WHERE id=?').get(req.params.id);
  if (!type || !req.file || req.uploadError) {
    removeUpload(req.file && `livestock/${req.file.filename}`);
    return res.redirect('/admin/livestock-catalog');
  }
  const image = `livestock/${req.file.filename}`;
  db.prepare('UPDATE livestock_types SET image=? WHERE id=?').run(image, type.id);
  removeUpload(type.image);
  logActivity(req, 'Updated livestock type photo', 'Livestock Type', type.id);
  res.redirect('/admin/livestock-catalog');
});
router.post('/livestock-types/:id/photo/delete', livestockEditor, (req, res) => {
  const row = db.prepare('SELECT image FROM livestock_types WHERE id=?').get(req.params.id);
  if (row) {
    db.prepare('UPDATE livestock_types SET image=NULL WHERE id=?').run(req.params.id);
    removeUpload(row.image);
    logActivity(req, 'Removed livestock type photo', 'Livestock Type', req.params.id);
  }
  res.redirect('/admin/livestock-catalog');
});
router.post('/livestock-classifications/:id/photo', livestockEditor, uploadSingle(livestockUpload, 'image'), validateMultipartCsrf, (req, res) => {
  const row = db.prepare('SELECT * FROM livestock_classifications WHERE id=?').get(req.params.id);
  if (!row || !req.file || req.uploadError) {
    removeUpload(req.file && `livestock/${req.file.filename}`);
    return res.redirect('/admin/livestock-catalog');
  }
  const image = `livestock/${req.file.filename}`;
  db.prepare('UPDATE livestock_classifications SET image=? WHERE id=?').run(image, row.id);
  removeUpload(row.image);
  logActivity(req, 'Updated classification photo', 'Classification', row.id);
  res.redirect('/admin/livestock-catalog');
});
router.post('/livestock-classifications/:id/photo/delete', livestockEditor, (req, res) => {
  const row = db.prepare('SELECT image FROM livestock_classifications WHERE id=?').get(req.params.id);
  if (row) {
    db.prepare('UPDATE livestock_classifications SET image=NULL WHERE id=?').run(req.params.id);
    removeUpload(row.image);
    logActivity(req, 'Removed classification photo', 'Classification', req.params.id);
  }
  res.redirect('/admin/livestock-catalog');
});

// ---------------- Dairy ----------------
router.get('/dairy', contentEditor, (_req, res) => res.render('admin/dairy', { title: 'Manage Our Products', products: db.prepare('SELECT * FROM dairy_products ORDER BY featured DESC,display_order,created_at DESC').all() }));
router.get('/dairy/new', contentEditor, (_req, res) => res.render('admin/dairy-form', { title: 'Add Our Product', product: null, error: null }));

function dairyPayload(body) {
  const name = safeText(body.name, 100);
  if (!name) throw new Error('Product name is required.');
  const priceText = safeText(body.price, 30);
  const price = priceText === '' ? null : Number.parseInt(priceText, 10);
  if (price !== null && (!Number.isSafeInteger(price) || price < 0)) throw new Error('Price must be a valid non-negative whole number.');
  return {
    name,
    slug: slugify(body.slug || name),
    description: safeText(body.description, 2000),
    category: safeText(body.category, 80) || 'Other dairy products',
    price,
    unit: safeText(body.unit, 40) || null,
    availability: ['Available', 'On Request', 'Unavailable'].includes(body.availability) ? body.availability : 'Available',
    featured: bool(body.featured),
    display_order: Math.max(0, int(body.display_order))
  };
}

router.post('/dairy', contentEditor, uploadSingle(dairyUpload, 'image'), validateMultipartCsrf, (req, res) => {
  let product;
  try { product = dairyPayload(req.body); }
  catch (error) { removeUpload(req.file && `dairy/${req.file.filename}`); return res.status(400).render('admin/dairy-form', { title: 'Add Our Product', product: req.body, error: error.message }); }
  if (req.uploadError) { removeUpload(req.file && `dairy/${req.file.filename}`); return res.status(400).render('admin/dairy-form', { title: 'Add Our Product', product: req.body, error: req.uploadError }); }
  const image = req.file ? `dairy/${req.file.filename}` : null;
  try {
    const result = db.prepare('INSERT INTO dairy_products (name,slug,description,image,availability,featured,category,price,unit,display_order) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(product.name, product.slug, product.description, image, product.availability, product.featured, product.category, product.price, product.unit, product.display_order);
    logActivity(req, 'Created product', 'Dairy Product', result.lastInsertRowid);
    res.redirect('/admin/dairy');
  } catch (error) {
    removeUpload(image);
    res.status(400).render('admin/dairy-form', { title: 'Add Our Product', product: req.body, error: error.message.includes('UNIQUE') ? 'That slug is already in use.' : 'Unable to save product.' });
  }
});

router.get('/dairy/:id/edit', contentEditor, (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) return res.redirect('/admin/dairy');
  res.render('admin/dairy-form', { title: 'Edit Our Product', product, error: null });
});

router.post('/dairy/:id', contentEditor, uploadSingle(dairyUpload, 'image'), validateMultipartCsrf, (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) { removeUpload(req.file && `dairy/${req.file.filename}`); return res.redirect('/admin/dairy'); }
  let product;
  try { product = dairyPayload(req.body); }
  catch (error) { removeUpload(req.file && `dairy/${req.file.filename}`); return res.status(400).render('admin/dairy-form', { title: 'Edit Our Product', product: { ...existing, ...req.body }, error: error.message }); }
  if (req.uploadError) { removeUpload(req.file && `dairy/${req.file.filename}`); return res.status(400).render('admin/dairy-form', { title: 'Edit Our Product', product: { ...existing, ...req.body }, error: req.uploadError }); }
  const image = req.file ? `dairy/${req.file.filename}` : existing.image;
  try {
    db.prepare('UPDATE dairy_products SET name=?,slug=?,description=?,image=?,availability=?,featured=?,category=?,price=?,unit=?,display_order=? WHERE id=?')
      .run(product.name, product.slug, product.description, image, product.availability, product.featured, product.category, product.price, product.unit, product.display_order, existing.id);
    if (req.file) removeUpload(existing.image);
    logActivity(req, 'Updated product', 'Dairy Product', existing.id);
    res.redirect('/admin/dairy');
  } catch (error) {
    if (req.file) removeUpload(`dairy/${req.file.filename}`);
    res.status(400).render('admin/dairy-form', { title: 'Edit Our Product', product: { ...existing, ...req.body, image: existing.image }, error: error.message.includes('UNIQUE') ? 'That slug is already in use.' : 'Unable to update product.' });
  }
});

router.post('/dairy/:id/delete', contentEditor, (req, res) => {
  const row = getProduct(req.params.id);
  if (!row) return res.redirect('/admin/dairy');
  db.prepare('DELETE FROM dairy_products WHERE id=?').run(req.params.id);
  removeUpload(row.image);
  logActivity(req, 'Deleted product', 'Dairy Product', req.params.id);
  res.redirect('/admin/dairy');
});

// ---------------- Gallery ----------------
router.get('/gallery', contentEditor, (_req, res) => res.render('admin/gallery', { title: 'Manage Gallery', items: db.prepare('SELECT * FROM gallery_items ORDER BY featured DESC,display_order,created_at DESC').all() }));
router.post('/gallery', contentEditor, uploadSingle(galleryUpload, 'image'), validateMultipartCsrf, (req, res) => {
  if (!req.file || req.uploadError) {
    removeUpload(req.file && `gallery/${req.file.filename}`);
    return res.redirect('/admin/gallery');
  }
  const image = `gallery/${req.file.filename}`;
  try {
    const result = db.prepare('INSERT INTO gallery_items (title,category,image,description,featured,display_order) VALUES (?,?,?,?,?,?)')
      .run(safeText(req.body.title, 120) || 'Farm Photo', safeText(req.body.category, 80) || 'Farm', image, safeText(req.body.description, 500), bool(req.body.featured), Math.max(0, int(req.body.display_order)));
    logActivity(req, 'Uploaded gallery photo', 'Gallery', result.lastInsertRowid);
  } catch {
    removeUpload(image);
  }
  res.redirect('/admin/gallery');
});
router.post('/gallery/:id', contentEditor, (req, res) => {
  const row = db.prepare('SELECT * FROM gallery_items WHERE id=?').get(req.params.id);
  if (row) {
    db.prepare('UPDATE gallery_items SET title=?,category=?,description=?,featured=?,display_order=? WHERE id=?')
      .run(safeText(req.body.title, 120) || row.title, safeText(req.body.category, 80) || row.category, safeText(req.body.description, 500), bool(req.body.featured), Math.max(0, int(req.body.display_order)), row.id);
    logActivity(req, 'Updated gallery photo', 'Gallery', row.id);
  }
  res.redirect('/admin/gallery');
});
router.post('/gallery/:id/replace', contentEditor, uploadSingle(galleryUpload, 'image'), validateMultipartCsrf, (req, res) => {
  const row = db.prepare('SELECT * FROM gallery_items WHERE id=?').get(req.params.id);
  if (!row || !req.file || req.uploadError) {
    removeUpload(req.file && `gallery/${req.file.filename}`);
    return res.redirect('/admin/gallery');
  }
  const image = `gallery/${req.file.filename}`;
  db.prepare('UPDATE gallery_items SET image=? WHERE id=?').run(image, row.id);
  removeUpload(row.image);
  logActivity(req, 'Replaced gallery photo', 'Gallery', row.id);
  res.redirect('/admin/gallery');
});
router.post('/gallery/:id/delete', contentEditor, (req, res) => {
  const row = db.prepare('SELECT image FROM gallery_items WHERE id=?').get(req.params.id);
  if (row) {
    db.prepare('DELETE FROM gallery_items WHERE id=?').run(req.params.id);
    removeUpload(row.image);
    logActivity(req, 'Deleted gallery photo', 'Gallery', req.params.id);
  }
  res.redirect('/admin/gallery');
});

// ---------------- FAQs ----------------
router.get('/faqs', contentEditor, (_req, res) => res.render('admin/faqs', { title: 'Manage FAQs', faqs: db.prepare('SELECT * FROM faqs ORDER BY display_order,id').all() }));
router.post('/faqs', contentEditor, (req, res) => {
  const question = safeText(req.body.question, 200);
  const answer = safeText(req.body.answer, 2000);
  if (question && answer) {
    const result = db.prepare('INSERT INTO faqs (question,answer,category,display_order,active) VALUES (?,?,?,?,?)')
      .run(question, answer, safeText(req.body.category, 80) || 'General', Math.max(0, int(req.body.display_order)), bool(req.body.active));
    logActivity(req, 'Created FAQ', 'FAQ', result.lastInsertRowid);
  }
  res.redirect('/admin/faqs');
});
router.post('/faqs/:id', contentEditor, (req, res) => {
  db.prepare('UPDATE faqs SET question=?,answer=?,category=?,display_order=?,active=? WHERE id=?')
    .run(safeText(req.body.question, 200), safeText(req.body.answer, 2000), safeText(req.body.category, 80) || 'General', Math.max(0, int(req.body.display_order)), bool(req.body.active), req.params.id);
  logActivity(req, 'Updated FAQ', 'FAQ', req.params.id);
  res.redirect('/admin/faqs');
});
router.post('/faqs/:id/delete', contentEditor, (req, res) => {
  db.prepare('DELETE FROM faqs WHERE id=?').run(req.params.id);
  logActivity(req, 'Deleted FAQ', 'FAQ', req.params.id);
  res.redirect('/admin/faqs');
});

// ---------------- Inquiries ----------------
router.get('/inquiries', inquiryManager, (_req, res) => res.render('admin/inquiries', {
  title: 'Customer Inquiries',
  inquiries: db.prepare(`
    SELECT i.*,a.name animal_name,d.name product_name
    FROM inquiries i
    LEFT JOIN animals a ON a.id=i.animal_id
    LEFT JOIN dairy_products d ON d.id=i.dairy_product_id
    ORDER BY CASE i.status WHEN 'New' THEN 0 WHEN 'Read' THEN 1 WHEN 'Replied' THEN 2 ELSE 3 END,i.created_at DESC
  `).all()
}));
router.post('/inquiries/:id/status', inquiryManager, (req, res) => {
  const status = ['New', 'Read', 'Replied', 'Archived'].includes(req.body.status) ? req.body.status : 'New';
  db.prepare('UPDATE inquiries SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.params.id);
  logActivity(req, `Inquiry status: ${status}`, 'Inquiry', req.params.id);
  res.redirect('/admin/inquiries');
});
router.post('/inquiries/:id/delete', inquiryManager, (req, res) => {
  db.prepare('DELETE FROM inquiries WHERE id=?').run(req.params.id);
  logActivity(req, 'Deleted inquiry', 'Inquiry', req.params.id);
  res.redirect('/admin/inquiries');
});

// ---------------- Reviews ----------------
router.get('/reviews', contentEditor, (req, res) => {
  const pageSize = 50;
  const requestedPage = Math.max(1, int(req.query.page, 1));
  const total = db.prepare('SELECT COUNT(*) count FROM reviews').get().count;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const reviews = db.prepare('SELECT * FROM reviews ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize);
  res.render('admin/reviews', { title: 'Manage Reviews', reviews, page, totalPages, total });
});
router.post('/reviews', contentEditor, (req, res) => {
  const name = safeText(req.body.customer_name, 100);
  const reviewText = safeText(req.body.review_text, 500);
  const rating = Math.min(Math.max(int(req.body.rating, 5), 1), 5);
  if (name && reviewText) {
    const result = db.prepare('INSERT INTO reviews (customer_name,rating,review_text,published) VALUES (?,?,?,?)').run(name, rating, reviewText, bool(req.body.published));
    logActivity(req, 'Created review', 'Review', result.lastInsertRowid);
  }
  res.redirect('/admin/reviews');
});
router.post('/reviews/:id/publish', contentEditor, (req, res) => {
  db.prepare('UPDATE reviews SET published=? WHERE id=?').run(bool(req.body.published), req.params.id);
  logActivity(req, 'Toggled review visibility', 'Review', req.params.id);
  res.redirect('/admin/reviews');
});
router.post('/reviews/:id/delete', contentEditor, (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id=?').run(req.params.id);
  logActivity(req, 'Deleted review', 'Review', req.params.id);
  res.redirect('/admin/reviews');
});

// ---------------- Website Settings / Content ----------------
const imageFields = ['logo_image', 'favicon_image', 'hero_image', 'about_image', 'about_image_2', 'about_image_3', 'footer_logo_image', 'livestock_image', 'dairy_image', 'experience_image', 'seo_social_image'];
const settingTextFields = [
  'site_name','site_description','footer_text','copyright_text','contact_phone','contact_email','contact_location','contact_address','contact_maps_url','business_hours','whatsapp_number','whatsapp_message','facebook_url','instagram_url','tiktok_url','youtube_url','other_social_url',
  'hero_title','hero_subtitle','hero_description','hero_cta_text','hero_cta_link','hero_secondary_text','hero_secondary_link',
  'homepage_featured_animals_limit','homepage_featured_dairy_limit','homepage_gallery_limit','homepage_offer_eyebrow','homepage_offer_title','homepage_offer_description','homepage_intro_eyebrow','homepage_intro_title','homepage_intro_description_1','homepage_intro_description_2','homepage_intro_link_text','homepage_explore_eyebrow','homepage_explore_title','homepage_explore_description','homepage_explore_1_title','homepage_explore_1_description','homepage_explore_1_cta','homepage_explore_2_title','homepage_explore_2_description','homepage_explore_2_cta','homepage_explore_3_title','homepage_explore_3_description','homepage_explore_3_cta','homepage_livestock_eyebrow','homepage_livestock_title','homepage_livestock_cta_text','homepage_dairy_eyebrow','homepage_dairy_title','homepage_dairy_cta_text','homepage_gallery_eyebrow','homepage_gallery_title','homepage_gallery_description','homepage_cta_eyebrow','homepage_cta_title','homepage_cta_description','homepage_cta_primary_text','homepage_cta_secondary_text','homepage_offer_1_title','homepage_offer_1_description','homepage_offer_2_title','homepage_offer_2_description','homepage_offer_3_title','homepage_offer_3_description','homepage_offer_4_title','homepage_offer_4_description','homepage_offer_5_title','homepage_offer_5_description','homepage_offer_6_title','homepage_offer_6_description','homepage_offer_7_title','homepage_offer_7_description','homepage_offer_8_title','homepage_offer_8_description','homepage_benefit_eyebrow','homepage_benefit_title','homepage_benefit_description','homepage_benefit_1_title','homepage_benefit_1_description','homepage_benefit_2_title','homepage_benefit_2_description','homepage_benefit_3_title','homepage_benefit_3_description',
  'about_eyebrow','about_title','about_lead','about_intro_eyebrow','about_intro_title','about_intro','about_story','about_mission','about_vision','about_values','about_caption','about_cta_eyebrow','about_cta_title','about_cta_description','about_cta_primary_text','about_cta_secondary_text',
  'livestock_page_eyebrow','livestock_page_title','livestock_page_lead','livestock_page_catalog_eyebrow','livestock_page_catalog_title','livestock_page_catalog_description',
  'animals_page_eyebrow','animals_page_title','animals_page_lead',
  'dairy_page_eyebrow','dairy_page_title','dairy_page_lead',
  'gallery_page_eyebrow','gallery_page_title','gallery_page_lead',
  'faq_page_eyebrow','faq_page_title','faq_page_lead','faq_cta_eyebrow','faq_cta_title','faq_cta_description','faq_cta_button_text',
  'contact_page_eyebrow','contact_page_title','contact_page_lead','contact_section_eyebrow','contact_section_title','contact_section_description','contact_section_note',
  'seo_home_title','seo_home_description','seo_livestock_title','seo_livestock_description','seo_about_title','seo_gallery_title','seo_contact_title','seo_keywords','seo_robots',
  'primary_color','secondary_color','accent_color','button_style'
];

router.get('/settings', contentEditor, (_req, res) => res.render('admin/settings', { title: 'Website Settings', siteSettings: db.getSiteSettings(), error: null, success: null }));

router.post('/settings', contentEditor, uploadFields(siteUpload, imageFields.map(name => ({ name, maxCount: 1 }))), (req, res) => {
  const current = db.getSiteSettings();
  if (req.uploadError) {
    removeUploadedFiles(req.files, 'site');
    return res.status(400).render('admin/settings', { title: 'Website Settings', siteSettings: current, error: req.uploadError, success: null });
  }
  const files = req.files || {};
  const newUploads = [];
  const values = {};

  settingTextFields.forEach(key => {
    const isLong = key.includes('description') || key.startsWith('about_') || key.startsWith('homepage_') || key === 'footer_text';
    values[key] = safeText(req.body[key], isLong ? 3000 : 500);
  });

  ['contact_maps_url','facebook_url','instagram_url','tiktok_url','youtube_url','other_social_url','hero_cta_link','hero_secondary_link'].forEach(key => {
    values[key] = safeUrl(values[key]);
  });

  if (values.contact_email && !EMAIL_PATTERN.test(values.contact_email)) {
    removeUploadedFiles(files, 'site');
    return res.status(400).render('admin/settings', { title: 'Website Settings', siteSettings: current, error: 'Please enter a valid contact email address.', success: null });
  }

  for (const key of ['homepage_featured_animals_limit', 'homepage_featured_dairy_limit', 'homepage_gallery_limit']) {
    const limit = Math.min(Math.max(int(values[key], 4), 1), 12);
    values[key] = String(limit);
  }

  values.primary_color = safeColor(values.primary_color, current.branding.primary);
  values.secondary_color = safeColor(values.secondary_color, current.branding.secondary);
  values.accent_color = safeColor(values.accent_color, current.branding.accent);
  values.button_style = ['rounded', 'soft', 'square'].includes(values.button_style) ? values.button_style : 'rounded';
  values.seo_robots = ['index,follow', 'noindex,nofollow', 'index,nofollow', 'noindex,follow'].includes(values.seo_robots) ? values.seo_robots : 'index,follow';
  values.show_whatsapp = bool(req.body.show_whatsapp) ? '1' : '0';
  values.show_social_icons = bool(req.body.show_social_icons) ? '1' : '0';

  const normalizeArray = value => Array.isArray(value) ? value : value ? [value] : [];
  const navLabels = normalizeArray(req.body.nav_label);
  const navPaths = normalizeArray(req.body.nav_path);
  const navVisible = normalizeArray(req.body.nav_visible);
  const navOrder = normalizeArray(req.body.nav_order);
  const navItems = navLabels.map((label, i) => ({
    label: safeText(label, 80),
    path: safeUrl(navPaths[i] || '#') || '#',
    visible: navVisible.includes(String(i)),
    order: Math.max(0, int(navOrder[i], i))
  })).filter(item => item.label && item.path).sort((a, b) => a.order - b.order).map(({ label, path, visible }) => ({ label, path, visible }));
  values.nav_items = JSON.stringify(navItems.length ? navItems : current.navItems);

  const footerLabels = normalizeArray(req.body.footer_label);
  const footerPaths = normalizeArray(req.body.footer_path);
  const footerLinks = footerLabels.map((label, i) => ({ label: safeText(label, 80), path: safeUrl(footerPaths[i] || '#') || '#' })).filter(item => item.label && item.path);
  values.footer_quick_links = JSON.stringify(footerLinks);

  const oldMap = {
    logo_image: current.logo,
    favicon_image: current.icon,
    hero_image: current.heroImage,
    about_image: current.aboutImage,
    about_image_2: current.aboutImage2,
    about_image_3: current.aboutImage3,
    footer_logo_image: current.footerLogo,
    livestock_image: current.featureImages.livestock,
    dairy_image: current.featureImages.dairy,
    experience_image: current.featureImages.experience,
    seo_social_image: current.seo.socialImage
  };

  imageFields.forEach(field => {
    const file = files[field]?.[0];
    const clear = bool(req.body[`clear_${field}`]);
    values[field] = oldMap[field] || null;
    if (file) {
      values[field] = `site/${file.filename}`;
      newUploads.push({ relative: values[field], old: oldMap[field] || null });
    } else if (clear) {
      values[field] = null;
      if (oldMap[field]) newUploads.push({ relative: null, old: oldMap[field] });
    }
  });

  values.homepage_featured_animals_limit = String(Math.min(Math.max(int(values.homepage_featured_animals_limit, 4), 1), 12));
  values.homepage_featured_dairy_limit = String(Math.min(Math.max(int(values.homepage_featured_dairy_limit, 4), 1), 12));
  values.homepage_gallery_limit = String(Math.min(Math.max(int(values.homepage_gallery_limit, 6), 1), 12));

  try {
    const save = db.transaction(() => Object.entries(values).forEach(([key, value]) => db.setSiteSetting(key, value)));
    save();
    newUploads.forEach(item => { if (item.old) removeUpload(item.old); });
    logActivity(req, 'Updated website settings', 'Settings', null);
    return res.render('admin/settings', { title: 'Website Settings', siteSettings: db.getSiteSettings(), error: null, success: 'Website settings saved successfully.' });
  } catch (error) {
    newUploads.forEach(item => { if (item.relative) removeUpload(item.relative); });
    console.error('Website settings save failed:', error.message);
    return res.status(400).render('admin/settings', { title: 'Website Settings', siteSettings: current, error: 'Unable to save website settings. Please try again.', success: null });
  }
});

// ---------------- Admin Users / Security ----------------
router.get('/users', requireSuperAdmin, (_req, res) => res.render('admin/users', adminUsersLocals()));

router.post('/users', requireSuperAdmin, async (req, res) => {
  const username = safeText(req.body.username, 120);
  const password = String(req.body.password || '');
  const role = ADMIN_ROLES.includes(req.body.role) ? req.body.role : 'Content Manager';
  if (!ADMIN_USERNAME_PATTERN.test(username) || password.length < 10) {
    return res.status(400).render('admin/users', adminUsersLocals('Username/email must be 3-120 characters and password must be at least 10 characters.'));
  }
  try {
    const result = db.prepare('INSERT INTO admin_users (username,password_hash,role,active) VALUES (?,?,?,1)').run(username, await bcrypt.hash(password, 12), role);
    logActivity(req, 'Created admin user', 'Admin User', result.lastInsertRowid);
    res.redirect('/admin/users');
  } catch {
    res.status(400).render('admin/users', adminUsersLocals('That username/email is already in use.'));
  }
});

router.post('/users/:id/role', requireSuperAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT id,username,role,active FROM admin_users WHERE id=?').get(id);
  const role = req.body.role;
  if (!target || !ADMIN_ROLES.includes(role) || id === Number(req.session.admin.id)) return res.redirect('/admin/users');
  if (target.active && target.role === 'Super Admin' && role !== 'Super Admin' && activeSuperAdminCount(id) < 1) {
    return res.status(400).render('admin/users', adminUsersLocals('At least one active Super Admin must remain.'));
  }
  db.prepare('UPDATE admin_users SET role=? WHERE id=?').run(role, id);
  revokeUserSessions(id);
  logActivity(req, `Changed admin role to ${role}`, 'Admin User', id);
  res.redirect('/admin/users');
});

router.post('/users/:id/reset-password', requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT id,username FROM admin_users WHERE id=?').get(id);
  const password = String(req.body.password || '');
  if (!target || id === Number(req.session.admin.id)) return res.redirect('/admin/users');
  if (password.length < 10) return res.status(400).render('admin/users', adminUsersLocals('The new administrator password must be at least 10 characters.'));
  db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(await bcrypt.hash(password, 12), id);
  revokeUserSessions(id);
  logActivity(req, 'Reset administrator password', 'Admin User', id);
  res.redirect('/admin/users');
});

router.post('/users/:id/toggle', requireSuperAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT id,username,role,active FROM admin_users WHERE id=?').get(id);
  if (!target || id === Number(req.session.admin.id)) return res.redirect('/admin/users');
  if (target.active && target.role === 'Super Admin' && activeSuperAdminCount(id) < 1) {
    return res.status(400).render('admin/users', adminUsersLocals('At least one active Super Admin must remain.'));
  }
  db.prepare('UPDATE admin_users SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?').run(id);
  if (target.active) revokeUserSessions(id);
  logActivity(req, `${target.active ? 'Disabled' : 'Enabled'} admin user`, 'Admin User', id);
  res.redirect('/admin/users');
});

router.post('/users/:id/delete', requireSuperAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT id,username,role,active FROM admin_users WHERE id=?').get(id);
  if (!target || id === Number(req.session.admin.id)) return res.redirect('/admin/users');
  if (target.active && target.role === 'Super Admin' && activeSuperAdminCount(id) < 1) {
    return res.status(400).render('admin/users', adminUsersLocals('At least one active Super Admin must remain.'));
  }
  revokeUserSessions(id);
  db.prepare('DELETE FROM admin_users WHERE id=?').run(id);
  logActivity(req, 'Deleted admin user', 'Admin User', id);
  res.redirect('/admin/users');
});

function revokeOtherAdminSessions(currentSessionId) {
  const rows = db.prepare('SELECT sid,data FROM sessions WHERE sid!=?').all(currentSessionId);
  const remove = db.prepare('DELETE FROM sessions WHERE sid=?');
  const tx = db.transaction(() => {
    for (const row of rows) {
      try {
        const data = JSON.parse(row.data);
        if (data.admin?.id) remove.run(row.sid);
      } catch {
        // Ignore malformed sessions.
      }
    }
  });
  tx();
}

function securityLocals(error = null, success = null, req = null) {
  const currentSessionId = req?.sessionID;
  const sessions = db.prepare('SELECT sid,data,expires_at FROM sessions WHERE expires_at>? ORDER BY expires_at DESC').all(Date.now()).map(row => {
    let data = {};
    try { data = JSON.parse(row.data); } catch { return null; }
    if (!data.admin?.id) return null;
    return {
      sid: row.sid,
      username: data.admin.username || 'Unknown',
      role: data.admin.role || '-',
      expires_at: row.expires_at,
      current: row.sid === currentSessionId
    };
  }).filter(Boolean);
  return {
    title: 'Security',
    error,
    success,
    activity: db.prepare(`SELECT a.*,u.username FROM admin_activity a LEFT JOIN admin_users u ON u.id=a.admin_user_id ORDER BY a.created_at DESC LIMIT 100`).all(),
    sessions
  };
}

router.get('/security', (req, res) => res.render('admin/security', securityLocals(null, null, req)));
router.post('/security/sessions/revoke-all', (req, res) => {
  revokeOtherAdminSessions(req.sessionID);
  logActivity(req, 'Revoked other administrator sessions', 'Security', null);
  res.redirect('/admin/security');
});
router.post('/security/password', async (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  const confirm = String(req.body.confirm_password || '');
  const user = db.prepare('SELECT * FROM admin_users WHERE id=?').get(req.session.admin.id);
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) return res.status(400).render('admin/security', securityLocals('Current password is incorrect.', null, req));
  if (newPassword.length < 10 || newPassword !== confirm) return res.status(400).render('admin/security', securityLocals('New passwords must match and be at least 10 characters.', null, req));
  db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(await bcrypt.hash(newPassword, 12), user.id);
  revokeOtherAdminSessions(req.sessionID);
  logActivity(req, 'Changed password', 'Admin User', user.id);
  res.render('admin/security', securityLocals(null, 'Password changed successfully. Other administrator sessions were signed out.', req));
});

module.exports = router;
