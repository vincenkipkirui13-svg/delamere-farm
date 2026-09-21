# Delamere Farm

A mobile-first livestock and dairy website built with Node.js, Express, EJS, SQLite, HTML, CSS and JavaScript.

## Included

Public pages: Home, About, Animals, Dairy, Gallery, FAQ and Contact.

Staff manager: Dashboard, Animals, Dairy Products, Gallery, FAQs, Customer Inquiries and Website Settings.

Website Settings can control the public website name, logo, favicon, hero photograph, About photograph and caption, Livestock feature photograph, Dairy feature photograph, Farm Experience photograph, phone, email, location, WhatsApp and social links.

The site is intentionally inquiry-based. It does not include online checkout, online payments, customer accounts or a shopping cart.

The admin area is separated into livestock, content, inquiries, website settings, administration and security. Public page headings, CTAs and core copy can be edited from Website Settings without changing source code.

## Windows / VS Code setup

1. Open this project folder in VS Code.
2. Make sure `.env` exists. Copy `.env.example` to `.env` if needed.
3. Set your own `ADMIN_USERNAME`, `ADMIN_PASSWORD` and a long `SESSION_SECRET` in `.env`.
4. Run:

```cmd
npm.cmd install
npm.cmd run setup
npm.cmd run seed
npm.cmd start
```

5. Open `http://localhost:3000`.
6. Staff login: `http://localhost:3000/admin/login`.

The terminal should remain occupied while the server is running. Press `Ctrl+C` to stop it.

## Image management

Authorized staff can upload JPG, PNG, WEBP or AVIF photographs up to 6 MB through Website Settings and the content managers. Use authentic farm photographs for the strongest result. Images are rendered responsively without forcing unnecessary crops or stretching the original photographs.

## Production notes

The application uses a SQLite-backed session store and CSRF protection. Use HTTPS, a strong secret, Railway persistent storage, and appropriate backups for the SQLite database and uploaded media.


## Production deployment
See `DEPLOYMENT.md` for Railway deployment, persistent storage, and production environment variables.

### Windows dependency note
The project pins `better-sqlite3` to the Node-API release used by the application. A root `.npmrc` keeps npm from invoking package lifecycle scripts during installation, avoiding the current Windows `node-gyp`/Python requirement for this project. Railway builds use Node 22 as declared in `package.json`.
