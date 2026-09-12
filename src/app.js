const express = require('express');
const session = require('express-session');
const settings = require('./config/settings');
const db = require('./db/database');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const format = require('./utils/format');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', settings.paths.views);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(settings.paths.public, { maxAge: '7d' }));
app.use('/uploads', express.static(settings.paths.uploads, { maxAge: '7d' }));

app.use(session({
  name: 'delamerefarm.sid',
  secret: settings.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.locals.helpers = format;
app.locals.currentPath = '';
app.locals.site = db.getSiteSettings();

app.use((req, res, next) => {
  res.locals.site = db.getSiteSettings();
  res.locals.currentPath = req.path;
  res.locals.isAdmin = Boolean(req.session?.admin);
  next();
});

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).render('pages/404', {
    title: 'Page Not Found',
    description: 'The page you requested could not be found.'
  });
});

app.use((err, req, res, _next) => {
  console.error(err);
  const message = process.env.NODE_ENV === 'production'
    ? 'Something went wrong. Please try again.'
    : err.message;

  if (req.path.startsWith('/admin')) {
    return res.status(500).render('admin/error', { title: 'Error', errorMessage: message });
  }
  return res.status(500).render('pages/500', { title: 'Something Went Wrong', errorMessage: message });
});

module.exports = app;
