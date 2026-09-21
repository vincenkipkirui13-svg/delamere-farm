const express = require('express');
const crypto = require('node:crypto');
const session = require('express-session');
const settings = require('./config/settings');
require('./db/livestock');
const db = require('./db/database');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const format = require('./utils/format');

class SQLiteSessionStore extends session.Store {
  constructor(database) { super(); this.db = database; }
  get(sid, callback) {
    try {
      const row = this.db.prepare('SELECT data,expires_at FROM sessions WHERE sid=?').get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) { this.db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); return callback(null, null); }
      callback(null, JSON.parse(row.data));
    } catch (error) { callback(error); }
  }
  set(sid, sess, callback) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000;
      this.db.prepare('INSERT INTO sessions (sid,data,expires_at) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at').run(sid, JSON.stringify(sess), expires);
      callback?.(null);
    } catch (error) { callback?.(error); }
  }
  destroy(sid, callback) { try { this.db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); callback?.(null); } catch (error) { callback?.(error); } }
  touch(sid, sess, callback) { try { const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000; this.db.prepare('UPDATE sessions SET expires_at=? WHERE sid=?').run(expires,sid); callback?.(null); } catch (error) { callback?.(error); } }
}

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', settings.isProduction ? 1 : false);
app.set('view engine', 'ejs');
app.set('views', settings.paths.views);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-DNS-Prefetch-Control', 'on');
  if (settings.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(settings.paths.public, { maxAge: settings.isProduction ? '7d' : 0 }));
app.use('/uploads', express.static(settings.paths.uploads, { maxAge: settings.isProduction ? '30d' : 0, index: false, setHeaders: res => { res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); } }));
app.use(session({
  name: 'delamerefarm.sid',
  secret: settings.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteSessionStore(db),
  cookie: { httpOnly: true, sameSite: 'lax', secure: settings.isProduction, maxAge: 1000 * 60 * 60 * 8 }
}));
app.locals.helpers = format;
app.locals.currentPath = '';
app.use((req, res, next) => {
  res.locals.site = db.getSiteSettings();
  res.locals.siteUrl = settings.siteUrl;
  res.locals.currentPath = req.path;
  res.locals.isAdmin = Boolean(req.session?.admin);
  res.locals.adminUser = req.session?.admin || null;
  if (req.session && !req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session?.csrfToken || '';
  next();
});
app.use('/', publicRoutes);
app.use('/admin', adminRoutes);
app.use((req, res) => res.status(404).render('pages/404', { title: 'Page Not Found', description: 'The page you requested could not be found.' }));
app.use((err, req, res, _next) => {
  console.error(err);
  const message = settings.isProduction ? 'Something went wrong. Please try again.' : err.message;
  if (req.path.startsWith('/admin')) return res.status(err.statusCode || 500).render('admin/error', { title: 'Error', errorMessage: message });
  return res.status(err.statusCode || 500).render('pages/500', { title: 'Something Went Wrong', errorMessage: message });
});
module.exports = app;
