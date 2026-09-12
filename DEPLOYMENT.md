# Delamere Farm Production Deployment

## Railway environment variables
Set these in Railway:
- NODE_ENV=production
- SESSION_SECRET=<long random value>
- ADMIN_USERNAME=<your admin username>
- ADMIN_PASSWORD=<strong password>
- SITE_NAME=Delamere Farm
- STORAGE_DIR=/data

Optional contact values can also be added:
SITE_PHONE, SITE_EMAIL, SITE_LOCATION, WHATSAPP_NUMBER, FACEBOOK_URL, INSTAGRAM_URL, TIKTOK_URL.

## Persistent storage
Attach a Railway Volume mounted at `/data`. `STORAGE_DIR=/data` makes both:
- `/data/delamerefarm.db`
- `/data/uploads/...`
persistent across redeployments.

## Deploy flow
1. Push this project to GitHub (do not push `.env`).
2. Create a Railway project from the GitHub repository.
3. Attach a Volume at `/data`.
4. Add the environment variables above.
5. Deploy. Railway supplies `PORT` automatically.
6. Open `/health` to confirm `{ "status": "ok" }`.
7. Open `/admin/login` and sign in.

## Important
Run `npm.cmd run seed` only when you intentionally want demo data. Do not seed an existing production database.
