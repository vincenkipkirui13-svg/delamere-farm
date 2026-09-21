const fs = require('node:fs');
const path = require('node:path');
const settings = require('../src/config/settings');
require('../src/db/database');

const folders = [
  settings.paths.public,
  settings.paths.uploads,
  path.join(settings.paths.uploads, 'animals'),
  path.join(settings.paths.uploads, 'dairy'),
  path.join(settings.paths.uploads, 'gallery'),
  settings.paths.siteUploads,
  path.join(settings.rootDir, 'data')
];
for (const folder of folders) fs.mkdirSync(folder, { recursive: true });

console.log('Delamere Farm database and folders are ready.');
console.log(`Start the site with: npm.cmd start`);
