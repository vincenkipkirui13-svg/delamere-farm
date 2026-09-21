const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const db = require('../src/db/database');

function request(server, path, options = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(options.body || null);
  });
}

test('public and admin entry routes render successfully', async t => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  for (const path of ['/', '/about', '/livestock', '/animals', '/dairy', '/gallery', '/faq', '/contact', '/admin/login', '/health']) {
    const response = await request(server, path);
    assert.equal(response.status, 200, `${path} should return 200`);
  }

  const missing = await request(server, '/this-page-does-not-exist');
  assert.equal(missing.status, 404);
  assert.match(missing.body, /name="robots" content="noindex, nofollow"/);
  assert.equal(missing.headers['x-content-type-options'], 'nosniff');
  assert.equal(missing.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(missing.headers['x-permitted-cross-domain-policies'], 'none');
});

test('database contains the core admin/content structures', () => {
  for (const table of ['animals', 'animal_photos', 'dairy_products', 'gallery_items', 'faqs', 'inquiries', 'reviews', 'site_settings', 'livestock_types', 'livestock_classifications', 'livestock_breeds', 'admin_users', 'admin_activity']) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    assert.ok(row, `missing table: ${table}`);
  }

  const settings = db.getSiteSettings();
  assert.ok(settings.navItems.length >= 1);
  assert.ok(settings.branding.primary);
  assert.ok(settings.seo.robots);
});
