@echo off
setlocal
cd /d "%~dp0"

echo Creating Delamere Farm project skeleton...
if not exist src mkdir src
if not exist src\config mkdir src\config
if not exist src\db mkdir src\db
if not exist src\routes mkdir src\routes
if not exist src\middleware mkdir src\middleware
if not exist src\utils mkdir src\utils
if not exist views mkdir views
if not exist views\partials mkdir views\partials
if not exist views\pages mkdir views\pages
if not exist views\admin mkdir views\admin
if not exist public mkdir public
if not exist public\css mkdir public\css
if not exist public\js mkdir public\js
if not exist public\images mkdir public\images
if not exist uploads mkdir uploads
if not exist uploads\animals mkdir uploads\animals
if not exist uploads\dairy mkdir uploads\dairy
if not exist uploads\gallery mkdir uploads\gallery
if not exist data mkdir data
if not exist tests mkdir tests
if not exist scripts mkdir scripts

for %%F in (package.json .env.example .gitignore README.md src\app.js src\server.js src\config\settings.js src\db\database.js src\routes\public.js src\routes\admin.js src\middleware\auth.js src\middleware\upload.js src\utils\slugify.js src\utils\format.js public\css\style.css public\js\main.js) do if not exist "%%F" type nul > "%%F"
for %%F in (views\partials\head.ejs views\partials\header.ejs views\partials\footer.ejs views\partials\page-hero.ejs views\partials\animal-card.ejs views\partials\dairy-card.ejs views\pages\home.ejs views\pages\about.ejs views\pages\animals.ejs views\pages\animal-detail.ejs views\pages\dairy.ejs views\pages\dairy-detail.ejs views\pages\gallery.ejs views\pages\faq.ejs views\pages\contact.ejs views\pages\contact-success.ejs views\pages\404.ejs views\pages\500.ejs views\admin\login.ejs views\admin\dashboard.ejs views\admin\animals.ejs views\admin\animal-form.ejs views\admin\dairy.ejs views\admin\dairy-form.ejs views\admin\gallery.ejs views\admin\faqs.ejs views\admin\inquiries.ejs views\admin\error.ejs tests\smoke.test.js scripts\setup.js scripts\seed.js) do if not exist "%%F" type nul > "%%F"
for %%F in (public\images\placeholder.svg public\images\farm-placeholder.svg public\images\favicon.svg) do if not exist "%%F" type nul > "%%F"

echo.
echo Skeleton creation complete.
echo.
endlocal
