# Delamere Farm

A mobile-first livestock and dairy website built with Node.js, Express, EJS, SQLite, HTML, CSS and JavaScript.

## Included

Public pages: Home, About, Animals, Dairy, Gallery, FAQ and Contact.

Staff manager: Dashboard, Animals, Dairy Products, Gallery, FAQs, Customer Inquiries and Website Settings.

Website Settings can control the public website name, logo, favicon, hero photograph, About photograph and caption, Livestock feature photograph, Dairy feature photograph, Farm Experience photograph, phone, email, location, WhatsApp and social links.

The site is intentionally inquiry-based. It does not include online checkout, online payments, customer accounts or a shopping cart.

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

Authorized staff can upload JPG, PNG, WEBP or AVIF photographs up to 6 MB through Website Settings and the content managers. Use authentic farm photographs for the strongest result. Images use responsive cropping and are never intentionally stretched.

## Production notes

Use a production-grade session store instead of Express's default in-memory session store. Use HTTPS, a strong secret, a production process manager/reverse proxy and appropriate backups for the SQLite database and uploaded media. Consider adding CSRF protection before public production deployment.


## Production deployment
See `DEPLOYMENT.md` for Railway deployment, persistent storage, and production environment variables.
