const express = require('express');
const db = require('../db/database');
const { imageUrl, truncate, mediaUrl, whatsappUrl } = require('../utils/format');
const slugify = require('../utils/slugify');

const router = express.Router();
const allowedInquiryTypes = new Set(['Animal', 'Dairy Product', 'General Inquiry']);

function getNavCounts() {
  return {
    animals: db.prepare("SELECT COUNT(*) AS count FROM animals WHERE availability = 'Available'").get().count,
    dairy: db.prepare("SELECT COUNT(*) AS count FROM dairy_products WHERE availability = 'Available'").get().count
  };
}

router.use((req, res, next) => {
  res.locals.helpers = { imageUrl, truncate, mediaUrl, whatsappUrl };
  next();
});

router.get('/', (req, res) => {
  const featuredAnimals = db.prepare("SELECT * FROM animals WHERE featured = 1 ORDER BY created_at DESC LIMIT 4").all();
  const featuredDairy = db.prepare("SELECT * FROM dairy_products WHERE featured = 1 ORDER BY created_at DESC LIMIT 4").all();
  const gallery = db.prepare("SELECT * FROM gallery_items ORDER BY featured DESC, created_at DESC LIMIT 6").all();
  const reviews = db.prepare("SELECT * FROM reviews WHERE published = 1 ORDER BY created_at DESC, id DESC LIMIT 15").all();
  const reviewCount = db.prepare("SELECT COUNT(*) AS count FROM reviews WHERE published = 1").get().count;
  const siteSettings = db.getSiteSettings();
  res.render('pages/home', {
    title: 'Quality Livestock & Dairy',
    description: 'Discover quality livestock and dairy products from Delamere Farm.',
    featuredAnimals,
    featuredDairy,
    gallery,
    siteSettings,
      reviews,
      reviewCount,
      counts: getNavCounts()
  });
});

router.get('/about', (_req, res) => {
  res.render('pages/about', {
    title: 'About Delamere Farm',
    description: 'Learn about Delamere Farm and our commitment to quality livestock and dairy products.',
    aboutImage: db.getSiteSettings().aboutImage,
    aboutCaption: db.getSiteSettings().aboutCaption
  });
});

router.get('/animals', (req, res) => {
  const category = String(req.query.category || '').trim();
  const search = String(req.query.search || '').trim();
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limit = 8;
  const offset = (page - 1) * limit;
  const params = [];
  const conditions = [];

  conditions.push("availability != 'Sold'");
  if (category) { conditions.push('category = ?'); params.push(category); }
  if (search) {
    conditions.push('(name LIKE ? OR breed LIKE ? OR description LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS count FROM animals ${where}`).get(...params).count;
  const animals = db.prepare(`SELECT * FROM animals ${where} ORDER BY featured DESC, created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const categories = db.prepare('SELECT DISTINCT category FROM animals ORDER BY category').all().map(row => row.category);

  res.render('pages/animals', {
    title: 'Our Animals',
    description: 'Browse livestock available from Delamere Farm.',
    animals,
    categories,
    selectedCategory: category,
    search,
    page,
    pages: Math.max(Math.ceil(total / limit), 1),
    total
  });
});

router.get('/animals/:slug', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE slug = ?').get(slugify(req.params.slug));
  if (!animal) return res.status(404).render('pages/404', { title: 'Animal Not Found', description: 'The animal you requested could not be found.' });
  const related = db.prepare('SELECT * FROM animals WHERE category = ? AND id != ? ORDER BY featured DESC, created_at DESC LIMIT 3').all(animal.category, animal.id);
  res.render('pages/animal-detail', {
    title: animal.name,
    description: `${animal.name} â€” ${animal.breed || animal.category} at Delamere Farm.`,
    animal,
    related,
    inquiryType: 'Animal',
    inquiryId: animal.id,
    inquiryName: animal.name
  });
});

router.get('/dairy', (req, res) => {
  const search = String(req.query.search || '').trim();
  const q = search ? `%${search}%` : null;
  const products = q
    ? db.prepare("SELECT * FROM dairy_products WHERE name LIKE ? OR description LIKE ? ORDER BY featured DESC, created_at DESC").all(q, q)
    : db.prepare('SELECT * FROM dairy_products ORDER BY featured DESC, created_at DESC').all();

  res.render('pages/dairy', {
    title: 'Dairy Products',
    description: 'Explore dairy products from Delamere Farm.',
    products,
    search
  });
});

router.get('/dairy/:slug', (req, res) => {
  const product = db.prepare('SELECT * FROM dairy_products WHERE slug = ?').get(slugify(req.params.slug));
  if (!product) return res.status(404).render('pages/404', { title: 'Product Not Found', description: 'The dairy product you requested could not be found.' });
  const related = db.prepare('SELECT * FROM dairy_products WHERE id != ? ORDER BY featured DESC, created_at DESC LIMIT 3').all(product.id);
  res.render('pages/dairy-detail', {
    title: product.name,
    description: `${product.name} from Delamere Farm.`,
    product,
    related,
    inquiryType: 'Dairy Product',
    inquiryId: product.id,
    inquiryName: product.name
  });
});

router.get('/gallery', (req, res) => {
  const category = String(req.query.category || '').trim();
  const conditions = category ? 'WHERE category = ?' : '';
  const gallery = category
    ? db.prepare(`SELECT * FROM gallery_items ${conditions} ORDER BY featured DESC, created_at DESC`).all(category)
    : db.prepare('SELECT * FROM gallery_items ORDER BY featured DESC, created_at DESC').all();
  const categories = db.prepare('SELECT DISTINCT category FROM gallery_items ORDER BY category').all().map(row => row.category);

  res.render('pages/gallery', {
    title: 'Farm Gallery',
    description: 'A glimpse into Delamere Farm.',
    gallery,
    categories,
    selectedCategory: category
  });
});

router.get('/faq', (_req, res) => {
  const faqs = db.prepare('SELECT * FROM faqs WHERE active = 1 ORDER BY display_order ASC, id ASC').all();
  res.render('pages/faq', {
    title: 'Frequently Asked Questions',
    description: 'Answers to common questions about Delamere Farm.',
    faqs
  });
});

router.get('/contact', (req, res) => {
  const inquiryType = allowedInquiryTypes.has(req.query.type) ? req.query.type : 'General Inquiry';
  const animalId = Number.parseInt(req.query.animal, 10) || null;
  const dairyId = Number.parseInt(req.query.product, 10) || null;
  let selectedAnimal = animalId ? db.prepare('SELECT id, name FROM animals WHERE id = ?').get(animalId) : null;
  let selectedProduct = dairyId ? db.prepare('SELECT id, name FROM dairy_products WHERE id = ?').get(dairyId) : null;
  res.render('pages/contact', {
    title: 'Contact Delamere Farm',
    description: 'Send an inquiry to Delamere Farm.',
    form: { full_name: '', phone: '', email: '', inquiry_type: inquiryType, animal_id: animalId || '', dairy_product_id: dairyId || '', message: '' },
    selectedAnimal,
    selectedProduct,
    errors: []
  });
});

router.post('/contact', (req, res) => {
  const fullName = String(req.body.full_name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const email = String(req.body.email || '').trim();
  const inquiryType = String(req.body.inquiry_type || '').trim();
  const message = String(req.body.message || '').trim();
  const animalId = Number.parseInt(req.body.animal_id, 10) || null;
  const dairyId = Number.parseInt(req.body.dairy_product_id, 10) || null;
  const errors = [];

  if (fullName.length < 2 || fullName.length > 80) errors.push('Please enter your full name.');
  if (!/^[0-9+()\-\s]{7,25}$/.test(phone)) errors.push('Please enter a valid phone number.');
  if (email && (email.length > 160 || !/^\S+@\S+\.\S+$/.test(email))) errors.push('Please enter a valid email address.');
  if (!allowedInquiryTypes.has(inquiryType)) errors.push('Please select a valid inquiry type.');
  if (message.length < 5 || message.length > 1500) errors.push('Please provide a short message with the details of your inquiry.');

  let selectedAnimal = animalId ? db.prepare('SELECT id, name FROM animals WHERE id = ?').get(animalId) : null;
  let selectedProduct = dairyId ? db.prepare('SELECT id, name FROM dairy_products WHERE id = ?').get(dairyId) : null;

  if (inquiryType === 'Animal' && !selectedAnimal) errors.push('The selected animal could not be found.');
  if (inquiryType === 'Dairy Product' && !selectedProduct) errors.push('The selected dairy product could not be found.');
  const finalAnimalId = inquiryType === 'Animal' && selectedAnimal ? selectedAnimal.id : null;
  const finalDairyId = inquiryType === 'Dairy Product' && selectedProduct ? selectedProduct.id : null;
  if (inquiryType !== 'Animal') selectedAnimal = null;
  if (inquiryType !== 'Dairy Product') selectedProduct = null;

  if (errors.length) {
    return res.status(400).render('pages/contact', {
      title: 'Contact Delamere Farm',
      description: 'Send an inquiry to Delamere Farm.',
      form: { full_name: fullName, phone, email, inquiry_type: inquiryType, animal_id: animalId || '', dairy_product_id: dairyId || '', message },
      selectedAnimal,
      selectedProduct,
      errors
    });
  }

  db.prepare(`INSERT INTO inquiries (full_name, phone, email, inquiry_type, animal_id, dairy_product_id, message)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(fullName, phone, email || null, inquiryType, finalAnimalId, finalDairyId, message);

  return res.render('pages/contact-success', {
    title: 'Inquiry Received',
    description: 'Your inquiry has been received by Delamere Farm.'
  });
});

module.exports = router;


