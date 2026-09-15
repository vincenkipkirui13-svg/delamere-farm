const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db/database');
const settings = require('../config/settings');
const slugify = require('../utils/slugify');
const { requireAuth } = require('../middleware/auth');
const { buildUploader } = require('../middleware/upload');

const router = express.Router();
const imageUpload = buildUploader('animals');
const dairyUpload = buildUploader('dairy');
const galleryUpload = buildUploader('gallery');
const siteUpload = buildUploader('site');
const adminPasswordHash = bcrypt.hashSync(settings.adminPassword, 12);

function safeText(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function bool(value) {
  return value === 'on' || value === '1' || value === 'true' ? 1 : 0;
}

function removeUpload(relativePath) {
  if (!relativePath) return;

  const root = path.resolve(settings.paths.uploads);
  const filePath = path.resolve(root, relativePath);

  if (
    (filePath === root || filePath.startsWith(`${root}${path.sep}`)) &&
    fs.existsSync(filePath)
  ) {
    fs.unlinkSync(filePath);
  }
}

function renderUploadError(res, title, message, locals) {
  return res.status(400).render('admin/error', {
    title,
    errorMessage: message,
    ...locals
  });
}

router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');

  res.render('admin/login', {
    title: 'Staff Login',
    error: null
  });
});

router.post('/login', async (req, res) => {
  const username = safeText(req.body.username, 80);
  const password = String(req.body.password || '');

  const matches =
    username === settings.adminUsername &&
    await bcrypt.compare(password, adminPasswordHash);

  if (!matches) {
    return res.status(401).render('admin/login', {
      title: 'Staff Login',
      error: 'Invalid username or password.'
    });
  }

  req.session.admin = { username };
  return res.redirect('/admin');
});

router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.use(requireAuth);

router.get('/', (_req, res) => {
  const stats = {
    animals: db.prepare('SELECT COUNT(*) count FROM animals').get().count,
    dairy: db.prepare('SELECT COUNT(*) count FROM dairy_products').get().count,
    gallery: db.prepare('SELECT COUNT(*) count FROM gallery_items').get().count,
    faqs: db.prepare('SELECT COUNT(*) count FROM faqs').get().count,
    reviews: db.prepare('SELECT COUNT(*) count FROM reviews').get().count,
    inquiries: db.prepare('SELECT COUNT(*) count FROM inquiries').get().count,
    newInquiries: db.prepare("SELECT COUNT(*) count FROM inquiries WHERE status = 'New'").get().count
  };

  const latestInquiries = db.prepare(`SELECT i.*, a.name animal_name, d.name product_name
    FROM inquiries i
    LEFT JOIN animals a ON a.id=i.animal_id
    LEFT JOIN dairy_products d ON d.id=i.dairy_product_id
    ORDER BY i.created_at DESC
    LIMIT 6`).all();

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    stats,
    latestInquiries
  });
});

router.get('/animals', (_req, res) => {
  res.render('admin/animals', {
    title: 'Manage Animals',
    animals: db.prepare(
      'SELECT * FROM animals ORDER BY featured DESC, created_at DESC'
    ).all()
  });
});

router.get('/animals/new', (_req, res) => {
  res.render('admin/animal-form', {
    title: 'Add Animal',
    animal: null,
    error: null
  });
});

router.post('/animals', imageUpload.single('image'), (req, res) => {
  const data = {
    name: safeText(req.body.name, 100),
    slug: slugify(req.body.slug || req.body.name),
    category: safeText(req.body.category, 60),
    breed: safeText(req.body.breed, 100),
    age: safeText(req.body.age, 40),
    gender: safeText(req.body.gender, 30),
    description: safeText(req.body.description, 2000),
    availability: safeText(req.body.availability, 30) || 'Available',
    featured: bool(req.body.featured),
    image: req.file ? `animals/${req.file.filename}` : null
  };

  try {
    db.prepare(`
      INSERT INTO animals (
        name,
        slug,
        category,
        breed,
        age,
        gender,
        description,
        image,
        availability,
        featured
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.name,
      data.slug,
      data.category,
      data.breed,
      data.age,
      data.gender,
      data.description,
      data.image,
      data.availability,
      data.featured
    );

    return res.redirect('/admin/animals');
  } catch (error) {
    removeUpload(data.image);

    return res.status(400).render('admin/animal-form', {
      title: 'Add Animal',
      animal: { ...req.body, image: null },
      error: error.message.includes('UNIQUE')
        ? 'That slug is already in use.'
        : 'Unable to save animal.'
    });
  }
});

router.get('/animals/:id/edit', (req, res) => {
  const animal = db.prepare(
    'SELECT * FROM animals WHERE id = ?'
  ).get(req.params.id);

  if (!animal) return res.redirect('/admin/animals');

  return res.render('admin/animal-form', {
    title: 'Edit Animal',
    animal,
    error: null
  });
});

router.post('/animals/:id', imageUpload.single('image'), (req, res) => {
  const existing = db.prepare(
    'SELECT * FROM animals WHERE id = ?'
  ).get(req.params.id);

  if (!existing) {
    removeUpload(req.file && `animals/${req.file.filename}`);
    return res.redirect('/admin/animals');
  }

  const image = req.file
    ? `animals/${req.file.filename}`
    : existing.image;

  const data = [
    safeText(req.body.name, 100),
    slugify(req.body.slug || req.body.name),
    safeText(req.body.category, 60),
    safeText(req.body.breed, 100),
    safeText(req.body.age, 40),
    safeText(req.body.gender, 30),
    safeText(req.body.description, 2000),
    image,
    safeText(req.body.availability, 30) || 'Available',
    bool(req.body.featured),
    existing.id
  ];

  try {
    db.prepare(`
      UPDATE animals
      SET
        name=?,
        slug=?,
        category=?,
        breed=?,
        age=?,
        gender=?,
        description=?,
        image=?,
        availability=?,
        featured=?
      WHERE id=?
    `).run(data);

    if (req.file) {
      removeUpload(existing.image);
    }

    return res.redirect('/admin/animals');
  } catch (error) {
    if (req.file) {
      removeUpload(image);
    }

    return res.status(400).render('admin/animal-form', {
      title: 'Edit Animal',
      animal: {
        ...existing,
        ...req.body,
        image: existing.image
      },
      error: error.message.includes('UNIQUE')
        ? 'That slug is already in use.'
        : 'Unable to update animal.'
    });
  }
});

router.post('/animals/:id/delete', (req, res) => {
  const animal = db.prepare(
    'SELECT image FROM animals WHERE id=?'
  ).get(req.params.id);

  db.prepare('DELETE FROM animals WHERE id=?').run(req.params.id);

  removeUpload(animal?.image);

  res.redirect('/admin/animals');
});

router.get('/dairy', (_req, res) =>
  res.render('admin/dairy', {
    title: 'Manage Dairy Products',
    products: db.prepare(
      'SELECT * FROM dairy_products ORDER BY featured DESC, created_at DESC'
    ).all()
  })
);

router.get('/dairy/new', (_req, res) =>
  res.render('admin/dairy-form', {
    title: 'Add Dairy Product',
    product: null,
    error: null
  })
);

router.post('/dairy', dairyUpload.single('image'), (req, res) => {
  const image = req.file ? `dairy/${req.file.filename}` : null;

  try {
    db.prepare(`
      INSERT INTO dairy_products (
        name,
        slug,
        description,
        image,
        availability,
        featured
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      safeText(req.body.name, 100),
      slugify(req.body.slug || req.body.name),
      safeText(req.body.description, 2000),
      image,
      safeText(req.body.availability, 30) || 'Available',
      bool(req.body.featured)
    );

    return res.redirect('/admin/dairy');
  } catch (error) {
    removeUpload(image);

    return res.status(400).render('admin/dairy-form', {
      title: 'Add Dairy Product',
      product: req.body,
      error: error.message.includes('UNIQUE')
        ? 'That slug is already in use.'
        : 'Unable to save product.'
    });
  }
});

router.get('/dairy/:id/edit', (req, res) => {
  const product = db.prepare(
    'SELECT * FROM dairy_products WHERE id = ?'
  ).get(req.params.id);

  if (!product) return res.redirect('/admin/dairy');

  return res.render('admin/dairy-form', {
    title: 'Edit Dairy Product',
    product,
    error: null
  });
});

router.post('/dairy/:id', dairyUpload.single('image'), (req, res) => {
  const existing = db.prepare(
    'SELECT * FROM dairy_products WHERE id=?'
  ).get(req.params.id);

  if (!existing) {
    removeUpload(req.file && `dairy/${req.file.filename}`);
    return res.redirect('/admin/dairy');
  }

  const image = req.file
    ? `dairy/${req.file.filename}`
    : existing.image;

  try {
    db.prepare(`
      UPDATE dairy_products
      SET
        name=?,
        slug=?,
        description=?,
        image=?,
        availability=?,
        featured=?
      WHERE id=?
    `).run(
      safeText(req.body.name, 100),
      slugify(req.body.slug || req.body.name),
      safeText(req.body.description, 2000),
      image,
      safeText(req.body.availability, 30) || 'Available',
      bool(req.body.featured),
      existing.id
    );

    if (req.file) {
      removeUpload(existing.image);
    }

    return res.redirect('/admin/dairy');
  } catch (error) {
    if (req.file) {
      removeUpload(image);
    }

    return res.status(400).render('admin/dairy-form', {
      title: 'Edit Dairy Product',
      product: {
        ...existing,
        ...req.body,
        image: existing.image
      },
      error: error.message.includes('UNIQUE')
        ? 'That slug is already in use.'
        : 'Unable to update product.'
    });
  }
});

router.post('/dairy/:id/delete', (req, res) => {
  const product = db.prepare(
    'SELECT image FROM dairy_products WHERE id=?'
  ).get(req.params.id);

  db.prepare('DELETE FROM dairy_products WHERE id=?').run(req.params.id);

  removeUpload(product?.image);

  res.redirect('/admin/dairy');
});

router.get('/gallery', (_req, res) =>
  res.render('admin/gallery', {
    title: 'Manage Gallery',
    items: db.prepare(
      'SELECT * FROM gallery_items ORDER BY featured DESC, created_at DESC'
    ).all()
  })
);

router.post('/gallery', galleryUpload.single('image'), (req, res) => {
  if (!req.file) return res.redirect('/admin/gallery');

  const image = `gallery/${req.file.filename}`;

  try {
    db.prepare(`
      INSERT INTO gallery_items (
        title,
        category,
        image,
        description,
        featured
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      safeText(req.body.title, 120) || 'Farm Photo',
      safeText(req.body.category, 50) || 'Farm',
      image,
      safeText(req.body.description, 500),
      bool(req.body.featured)
    );

    return res.redirect('/admin/gallery');
  } catch (error) {
    removeUpload(image);

    return renderUploadError(
      res,
      'Gallery',
      'Unable to save gallery image.',
      {}
    );
  }
});

router.post('/gallery/:id/delete', (req, res) => {
  const item = db.prepare(
    'SELECT image FROM gallery_items WHERE id=?'
  ).get(req.params.id);

  db.prepare('DELETE FROM gallery_items WHERE id=?').run(req.params.id);

  removeUpload(item?.image);

  res.redirect('/admin/gallery');
});

router.get('/faqs', (_req, res) =>
  res.render('admin/faqs', {
    title: 'Manage FAQs',
    faqs: db.prepare(
      'SELECT * FROM faqs ORDER BY display_order ASC, id ASC'
    ).all()
  })
);

router.post('/faqs', (req, res) => {
  const question = safeText(req.body.question, 200);
  const answer = safeText(req.body.answer, 1200);
  const order = Number.parseInt(req.body.display_order, 10) || 0;
  const active = bool(req.body.active);

  if (question && answer) {
    db.prepare(`
      INSERT INTO faqs (
        question,
        answer,
        display_order,
        active
      )
      VALUES (?, ?, ?, ?)
    `).run(question, answer, order, active);
  }

  res.redirect('/admin/faqs');
});

router.post('/faqs/:id/delete', (req, res) => {
  db.prepare('DELETE FROM faqs WHERE id=?').run(req.params.id);
  res.redirect('/admin/faqs');
});

router.get('/settings', (_req, res) => {
  res.render('admin/settings', {
    title: 'Website Settings',
    siteSettings: db.getSiteSettings(),
    error: null,
    success: null
  });
});

router.post('/settings', siteUpload.fields([
  { name: 'logo_image', maxCount: 1 },
  { name: 'favicon_image', maxCount: 1 },
  { name: 'hero_image', maxCount: 1 },
  { name: 'about_image', maxCount: 1 },
  { name: 'livestock_image', maxCount: 1 },
  { name: 'dairy_image', maxCount: 1 },
  { name: 'experience_image', maxCount: 1 }
]), (req, res) => {
  const current = db.getSiteSettings();
  const files = req.files || {};

  const map = {
    logo_image: current.logo,
    favicon_image: current.icon,
    hero_image: current.heroImage,
    about_image: current.aboutImage,
    livestock_image: current.featureImages.livestock,
    dairy_image: current.featureImages.dairy,
    experience_image: current.featureImages.experience
  };

  const values = {
    site_name: safeText(req.body.site_name, 100) || 'Delamere Farm',
    contact_phone: safeText(req.body.contact_phone, 40),
    contact_email: safeText(req.body.contact_email, 160),
    contact_location: safeText(req.body.contact_location, 180),
    whatsapp_number: safeText(req.body.whatsapp_number, 40),
    facebook_url: safeText(req.body.facebook_url, 300),
    instagram_url: safeText(req.body.instagram_url, 300),
    tiktok_url: safeText(req.body.tiktok_url, 300),
    about_caption: safeText(req.body.about_caption, 180),
    logo_image: map.logo_image,
    favicon_image: map.favicon_image,
    hero_image: map.hero_image,
    about_image: map.about_image,
    livestock_image: map.livestock_image,
    dairy_image: map.dairy_image,
    experience_image: map.experience_image
  };

  const newUploads = [];

  try {
    for (const field of Object.keys(map)) {
      const file = files[field]?.[0];

      if (file) {
        const relative = `site/${file.filename}`;
        values[field] = relative;
        newUploads.push({
          relative,
          old: map[field]
        });
      }
    }

    const save = db.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        db.setSiteSetting(key, value);
      }
    });

    save();

    for (const item of newUploads) {
      removeUpload(item.old);
    }

    return res.render('admin/settings', {
      title: 'Website Settings',
      siteSettings: db.getSiteSettings(),
      error: null,
      success: 'Website settings saved successfully.'
    });
  } catch (error) {
    for (const item of newUploads) {
      removeUpload(item.relative);
    }

    console.error(error);

    return res.status(400).render('admin/settings', {
      title: 'Website Settings',
      siteSettings: current,
      error: 'Unable to save website settings. Please try again.',
      success: null
    });
  }
});

router.get('/inquiries', (_req, res) => {
  const inquiries = db.prepare(`
    SELECT i.*, a.name animal_name, d.name product_name
    FROM inquiries i
    LEFT JOIN animals a ON a.id=i.animal_id
    LEFT JOIN dairy_products d ON d.id=i.dairy_product_id
    ORDER BY i.created_at DESC
  `).all();

  res.render('admin/inquiries', {
    title: 'Customer Inquiries',
    inquiries
  });
});

router.post('/inquiries/:id/status', (req, res) => {
  const status = ['New', 'Contacted', 'Resolved'].includes(req.body.status)
    ? req.body.status
    : 'New';

  db.prepare(
    'UPDATE inquiries SET status=? WHERE id=?'
  ).run(status, req.params.id);

  res.redirect('/admin/inquiries');
});

router.get('/reviews', (_req, res) => {
  const reviews = db.prepare(
    'SELECT * FROM reviews ORDER BY created_at DESC, id DESC'
  ).all();

  res.render('admin/reviews', {
    title: 'Manage Reviews',
    reviews
  });
});

router.post('/reviews', (req, res) => {
  const name = safeText(req.body.customer_name, 100);
  const reviewText = safeText(req.body.review_text, 500);
  const rating = Math.min(Math.max(Number.parseInt(req.body.rating, 10) || 5, 1), 5);
  const published = bool(req.body.published);

  if (name && reviewText) {
    db.prepare(
      'INSERT INTO reviews (customer_name, rating, review_text, published) VALUES (?, ?, ?, ?)'
    ).run(name, rating, reviewText, published);
  }

  res.redirect('/admin/reviews');
});

router.post('/reviews/:id/publish', (req, res) => {
  db.prepare(
    'UPDATE reviews SET published=? WHERE id=?'
  ).run(bool(req.body.published), req.params.id);

  res.redirect('/admin/reviews');
});

router.post('/reviews/:id/delete', (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id=?').run(req.params.id);
  res.redirect('/admin/reviews');
});
module.exports = router;