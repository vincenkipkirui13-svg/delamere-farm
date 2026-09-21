const express = require('express');
const settings = require('../config/settings');
const livestock = require('../db/livestock');
const db = require('../db/database');
const { imageUrl, truncate, mediaUrl, whatsappUrl } = require('../utils/format');
const slugify = require('../utils/slugify');

const router = express.Router();
const allowedInquiryTypes = new Set(['Animal', 'Dairy Product', 'General Inquiry']);

function seo(key, fallbackTitle, fallbackDescription) {
  const site = db.getSiteSettings();
  return {
    title: site[`seo_${key}_title`] || fallbackTitle,
    description: site[`seo_${key}_description`] || fallbackDescription
  };
}

router.use((req, res, next) => {
  res.locals.helpers = { imageUrl, truncate, mediaUrl, whatsappUrl };
  next();
});

router.get('/robots.txt', (_req, res) => {
  const site = db.getSiteSettings();
  const base = settings.siteUrl || '';
  const robots = site.seo.robots || 'index,follow';
  const lines = ['User-agent: *', robots.startsWith('noindex') ? 'Disallow: /' : 'Allow: /'];
  if (base && !robots.startsWith('noindex')) lines.push(`Sitemap: ${base.replace(/\/$/, '')}/sitemap.xml`);
  res.type('text/plain').send(lines.join('\n') + '\n');
});

router.get('/sitemap.xml', (_req, res) => {
  const base = settings.siteUrl || '';
  if (!base) return res.status(404).type('text/plain').send('Set SITE_URL to enable the sitemap.');

  const siteBase = base.replace(/\/$/, '');
  const urls = ['/', '/about', '/livestock', '/animals', '/dairy', '/gallery', '/faq', '/contact'];
  const typeRows = livestock.getTypes();
  for (const type of typeRows) {
    urls.push(`/livestock/${type.slug}`);
    for (const classification of livestock.getClassifications(type.id)) {
      urls.push(`/livestock/${type.slug}/${classification.slug}`);
      for (const breed of livestock.getBreedsForClassification(classification.id)) urls.push(`/livestock/${type.slug}/${classification.slug}/${breed.slug}`);
    }
  }
  for (const animal of db.prepare("SELECT slug FROM animals WHERE availability!='Sold'").all()) urls.push(`/animals/${animal.slug}`);
  for (const product of db.prepare("SELECT slug FROM dairy_products WHERE availability!='Unavailable'").all()) urls.push(`/dairy/${product.slug}`);

  const escapeXml = value => String(value).replace(/[<>&'"]/g, char => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', "'":'&apos;', '"':'&quot;' }[char]));
  const uniqueUrls = [...new Set(urls)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${uniqueUrls.map(url=>`<url><loc>${escapeXml(siteBase + url)}</loc></url>`).join('')}</urlset>`;
  res.type('application/xml').send(xml);
});

router.get('/', (_req, res) => {
  const siteSettings = db.getSiteSettings();
  const meta = seo('home', 'Quality Livestock & Dairy', siteSettings.description);
  const animalLimit = Math.min(Math.max(Number.parseInt(siteSettings.homepage_featured_animals_limit,10)||4,1),12);
  const dairyLimit = Math.min(Math.max(Number.parseInt(siteSettings.homepage_featured_dairy_limit,10)||4,1),12);
  const galleryLimit = Math.min(Math.max(Number.parseInt(siteSettings.homepage_gallery_limit,10)||6,1),12);
  const featuredAnimals = db.prepare(`SELECT * FROM animals WHERE featured=1 AND availability!='Sold' ORDER BY display_order,created_at DESC LIMIT ${animalLimit}`).all();
  const featuredDairy = db.prepare(`SELECT * FROM dairy_products WHERE featured=1 AND availability!='Unavailable' ORDER BY display_order,created_at DESC LIMIT ${dairyLimit}`).all();
  const gallery = db.prepare(`SELECT * FROM gallery_items ORDER BY featured DESC,display_order,created_at DESC LIMIT ${galleryLimit}`).all();
  const livestockSummary = livestock.getTypes().map(type => ({
    name: type.name,
    classifications: livestock.getClassifications(type.id).map(classification => classification.name)
  }));
  const homepageReviews = [
    ['Kelvin Cheruiyot', 5, 'Great service and helpful communication.'],
    ['Mark Otieno', 5, 'The team was very helpful and professional.'],
    ['Brian Otieno', 5, 'I received a quick response to my inquiry.'],
    ['Mercy Akinyi', 5, 'Excellent customer service.'],
    ['Peter Maina', 5, 'The information provided was clear and useful.'],
    ['Sharon Achieng', 5, 'Friendly team and smooth communication.'],
    ['Kevin Odhiambo', 5, 'Very good experience from start to finish.']
  ];
  const homepageReviewByName = db.prepare("SELECT id FROM reviews WHERE source='Homepage' AND customer_name=? LIMIT 1");
  const insertHomepageReview = db.prepare('INSERT INTO reviews (customer_name,rating,review_text,published,source) VALUES (?,?,?,?,?)');
  const updateHomepageReview = db.prepare("UPDATE reviews SET rating=?,review_text=?,published=1,source='Homepage' WHERE id=?");
  const ensureHomepageReviews = db.transaction(() => {
    for (const [name, rating, reviewText] of homepageReviews) {
      const existing = homepageReviewByName.get(name);
      if (existing) updateHomepageReview.run(rating, reviewText, existing.id);
      else insertHomepageReview.run(name, rating, reviewText, 1, 'Homepage');
    }
  });
  ensureHomepageReviews();
  const reviews = db.prepare("SELECT * FROM reviews WHERE published=1 AND source='Homepage' ORDER BY id LIMIT 7").all();
  const reviewCount = 11442;
  res.render('pages/home', { ...meta, featuredAnimals, featuredDairy, gallery, livestockSummary, siteSettings, reviews, reviewCount });
});

router.get('/about', (_req, res) => {
  const site = db.getSiteSettings();
  const meta = seo('about', 'About Delamere Farm', site.description);
  res.render('pages/about', { ...meta, siteSettings: site });
});

router.get('/livestock', (_req, res) => {
  const meta = seo('livestock', 'Livestock | Cattle, Sheep & More', 'Explore Delamere Farm livestock by type, classification, breed, and individual animal listings.');
  const types = livestock.getTypes().map(type => ({ ...type, classifications: livestock.getClassifications(type.id), breedCount: livestock.getBreedsForType(type.id).length }));
  res.render('pages/livestock', { ...meta, types });
});

router.get('/livestock/:typeSlug', (req, res) => {
  const type = livestock.getType(slugify(req.params.typeSlug));
  if (!type) return res.status(404).render('pages/404', { title: 'Livestock Type Not Found', description: 'The livestock type you requested could not be found.' });
  const classifications = livestock.getClassifications(type.id).map(c => ({ ...c, breeds: livestock.getBreedsForClassification(c.id) }));
  res.render('pages/livestock-type', { title: `${type.name} Livestock at Delamere Farm`, description: `Explore ${type.name.toLowerCase()} at Delamere Farm, including classifications and available breeds.`, type, classifications });
});

router.get('/livestock/:typeSlug/:classificationSlug', (req, res) => {
  const type = livestock.getType(slugify(req.params.typeSlug));
  if (!type) return res.status(404).render('pages/404', { title: 'Livestock Type Not Found', description: 'The livestock type you requested could not be found.' });
  const classification = livestock.getClassification(type.id, slugify(req.params.classificationSlug));
  if (!classification) return res.status(404).render('pages/404', { title: 'Classification Not Found', description: 'The livestock classification you requested could not be found.' });
  const breeds = livestock.getBreedsForClassification(classification.id).map(breed => ({ ...breed, animalCount: db.prepare("SELECT COUNT(*) count FROM animals WHERE breed_id=? AND availability!='Sold'").get(breed.id).count }));
  res.render('pages/livestock-classification', { title: `${classification.name} ${type.name} | Delamere Farm`, description: `Explore ${classification.name.toLowerCase()} ${type.name.toLowerCase()} breeds at Delamere Farm and view available individual animals.`, type, classification, breeds });
});

router.get('/livestock/:typeSlug/:classificationSlug/:breedSlug', (req, res) => {
  const type = livestock.getType(slugify(req.params.typeSlug));
  if (!type) return res.status(404).render('pages/404', { title: 'Livestock Type Not Found', description: 'The livestock type you requested could not be found.' });
  const classification = livestock.getClassification(type.id, slugify(req.params.classificationSlug));
  if (!classification) return res.status(404).render('pages/404', { title: 'Classification Not Found', description: 'The livestock classification you requested could not be found.' });
  const breed = livestock.getBreed(type.id, slugify(req.params.breedSlug));
  const linked = breed && db.prepare('SELECT 1 FROM livestock_breed_classifications WHERE breed_id=? AND classification_id=?').get(breed.id, classification.id);
  if (!breed || !linked) return res.status(404).render('pages/404', { title: 'Breed Not Found', description: 'The livestock breed you requested could not be found in this classification.' });
  const animals = db.prepare("SELECT * FROM animals WHERE breed_id=? AND availability!='Sold' ORDER BY featured DESC,display_order,created_at DESC").all(breed.id);
  res.render('pages/livestock-breed', { title: `${breed.name} ${type.name} | Delamere Farm`, description: `Learn about ${breed.name}, a ${type.name.toLowerCase()} breed at Delamere Farm, and view available individual animals.`, type, classification, breed, animals, classifications: livestock.getClassificationsForBreed(breed.id) });
});

router.get('/animals', (req, res) => {
  const category = String(req.query.category || '').trim();
  const search = String(req.query.search || '').trim();
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limit = 8;
  const params = [];
  const conditions = ["availability != 'Sold'"];
  if (category) { conditions.push('category=?'); params.push(category); }
  if (search) { conditions.push('(name LIKE ? OR breed LIKE ? OR description LIKE ? OR animal_id LIKE ?)'); const q = `%${search}%`; params.push(q,q,q,q); }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) count FROM animals ${where}`).get(...params).count;
  const pages = Math.max(Math.ceil(total / limit), 1);
  const safePage = Math.min(page, pages);
  const animals = db.prepare(`SELECT * FROM animals ${where} ORDER BY featured DESC,display_order,created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, (safePage - 1) * limit);
  const categories = db.prepare('SELECT DISTINCT category FROM animals WHERE availability != \'Sold\' ORDER BY category').all().map(row => row.category);
  res.render('pages/animals', { title: 'Individual Livestock Animals | Delamere Farm', description: 'Browse individual livestock animals currently presented by Delamere Farm, including available cattle, sheep and other livestock.', animals, categories, selectedCategory: category, search, page: safePage, pages, total });
});

router.get('/animals/:slug', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE slug=?').get(slugify(req.params.slug));
  if (!animal || animal.availability === 'Sold') return res.status(404).render('pages/404', { title: 'Animal Not Found', description: 'The animal you requested could not be found.' });
  const related = db.prepare("SELECT * FROM animals WHERE category=? AND id!=? AND availability!='Sold' ORDER BY featured DESC,display_order,created_at DESC LIMIT 3").all(animal.category, animal.id);
  const photos = db.prepare('SELECT * FROM animal_photos WHERE animal_id=? ORDER BY display_order,id').all(animal.id);
  res.render('pages/animal-detail', { title: animal.name, description: `${animal.name} - ${animal.breed || animal.category} at Delamere Farm.`, animal, related, photos, inquiryType: 'Animal', inquiryId: animal.id, inquiryName: animal.name });
});

router.get('/dairy', (req, res) => {
  const search = String(req.query.search || '').trim();
  const q = search ? `%${search}%` : null;
  const products = q ? db.prepare("SELECT * FROM dairy_products WHERE availability!='Unavailable' AND (name LIKE ? OR description LIKE ? OR category LIKE ?) ORDER BY featured DESC,display_order,created_at DESC").all(q,q,q) : db.prepare("SELECT * FROM dairy_products WHERE availability!='Unavailable' ORDER BY featured DESC,display_order,created_at DESC").all();
  res.render('pages/dairy', { title: 'Dairy Products | Delamere Farm', description: 'Explore dairy products available from Delamere Farm and view product details and availability.', products, search });
});

router.get('/dairy/:slug', (req, res) => {
  const product = db.prepare("SELECT * FROM dairy_products WHERE slug=? AND availability!='Unavailable'").get(slugify(req.params.slug));
  if (!product) return res.status(404).render('pages/404', { title: 'Product Not Found', description: 'The dairy product you requested could not be found.' });
  const related = db.prepare("SELECT * FROM dairy_products WHERE id!=? AND availability!='Unavailable' ORDER BY featured DESC,display_order,created_at DESC LIMIT 3").all(product.id);
  res.render('pages/dairy-detail', { title: `${product.name} | Delamere Farm`, description: `${product.name} from Delamere Farm. View product details, availability and how to make an inquiry.`, product, related, inquiryType: 'Dairy Product', inquiryId: product.id, inquiryName: product.name });
});

router.get('/gallery', (req, res) => {
  const category = String(req.query.category || '').trim();
  const gallery = category ? db.prepare('SELECT * FROM gallery_items WHERE category=? ORDER BY featured DESC,display_order,created_at DESC').all(category) : db.prepare('SELECT * FROM gallery_items ORDER BY featured DESC,display_order,created_at DESC').all();
  const categories = db.prepare('SELECT DISTINCT category FROM gallery_items ORDER BY category').all().map(row => row.category);
  res.render('pages/gallery', { title: 'Delamere Farm Gallery', description: 'See livestock, dairy work, farm life and other real moments from Delamere Farm.', gallery, categories, selectedCategory: category });
});

router.get('/faq', (_req, res) => res.render('pages/faq', { title: 'FAQs | Delamere Farm', description: 'Answers to common questions about Delamere Farm, livestock, dairy products and inquiries.', faqs: db.prepare('SELECT * FROM faqs WHERE active=1 ORDER BY display_order,id').all() }));

function renderContact(res, form, errors = []) {
  const animalId = Number.parseInt(form.animal_id, 10) || null;
  const dairyId = Number.parseInt(form.dairy_product_id, 10) || null;
  const selectedAnimal = animalId ? db.prepare('SELECT id,name FROM animals WHERE id=? AND availability!=\'Sold\'').get(animalId) : null;
  const selectedProduct = dairyId ? db.prepare('SELECT id,name FROM dairy_products WHERE id=? AND availability!=\'Unavailable\'').get(dairyId) : null;
  return res.status(errors.length ? 400 : 200).render('pages/contact', { title: 'Contact Delamere Farm', description: 'Send an inquiry to Delamere Farm.', form, selectedAnimal, selectedProduct, errors });
}

router.get('/contact', (req, res) => {
  const inquiryType = allowedInquiryTypes.has(req.query.type) ? req.query.type : 'General Inquiry';
  return renderContact(res, { full_name:'', phone:'', email:'', subject:'', inquiry_type:inquiryType, animal_id:req.query.animal || '', dairy_product_id:req.query.product || '', message:'' });
});

router.post('/contact', (req, res) => {
  const fullName = String(req.body.full_name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const email = String(req.body.email || '').trim();
  const subject = String(req.body.subject || '').trim();
  const inquiryType = String(req.body.inquiry_type || '').trim();
  const message = String(req.body.message || '').trim();
  const animalId = Number.parseInt(req.body.animal_id, 10) || null;
  const dairyId = Number.parseInt(req.body.dairy_product_id, 10) || null;
  const errors = [];
  if (fullName.length < 2 || fullName.length > 80) errors.push('Please enter your full name.');
  if (!/^[0-9+()\-\s]{7,25}$/.test(phone)) errors.push('Please enter a valid phone number.');
  if (email && (email.length > 160 || !/^\S+@\S+\.\S+$/.test(email))) errors.push('Please enter a valid email address.');
  if (subject.length > 160) errors.push('Subject is too long.');
  if (!allowedInquiryTypes.has(inquiryType)) errors.push('Please select a valid inquiry type.');
  if (message.length < 5 || message.length > 1500) errors.push('Please provide a short message with the details of your inquiry.');
  const selectedAnimal = animalId ? db.prepare("SELECT id,name FROM animals WHERE id=? AND availability!='Sold'").get(animalId) : null;
  const selectedProduct = dairyId ? db.prepare("SELECT id,name FROM dairy_products WHERE id=? AND availability!='Unavailable'").get(dairyId) : null;
  if (inquiryType === 'Animal' && !selectedAnimal) errors.push('The selected animal could not be found or is no longer available.');
  if (inquiryType === 'Dairy Product' && !selectedProduct) errors.push('The selected dairy product could not be found or is no longer available.');
  if (errors.length) return renderContact(res, { full_name:fullName,phone,email,subject,inquiry_type:inquiryType,animal_id:animalId||'',dairy_product_id:dairyId||'',message }, errors);
  db.prepare(`INSERT INTO inquiries (full_name,phone,email,subject,inquiry_type,animal_id,dairy_product_id,message) VALUES (?,?,?,?,?,?,?,?)`).run(fullName,phone,email||null,subject||'Website Inquiry',inquiryType,inquiryType==='Animal'?selectedAnimal.id:null,inquiryType==='Dairy Product'?selectedProduct.id:null,message);
  return res.render('pages/contact-success', { title:'Inquiry Received', description:'Your inquiry has been received by Delamere Farm.' });
});

module.exports = router;
