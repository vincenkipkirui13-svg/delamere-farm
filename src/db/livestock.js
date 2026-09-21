const db = require('./database');
const slugify = require('../utils/slugify');

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}
function addColumn(table, column, definition) {
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumn('animals', 'livestock_type', 'TEXT');
addColumn('animals', 'livestock_classification', 'TEXT');
addColumn('animals', 'breed_id', 'INTEGER');
addColumn('animals', 'price', 'INTEGER');
addColumn('animals', 'animal_id', 'TEXT');
addColumn('animals', 'date_of_birth', 'TEXT');
addColumn('animals', 'sex', 'TEXT');
addColumn('animals', 'price_range', 'TEXT');
addColumn('animals', 'health_information', 'TEXT');
addColumn('animals', 'breeding_information', 'TEXT');
addColumn('animals', 'production_information', 'TEXT');
addColumn('animals', 'display_order', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`
CREATE TABLE IF NOT EXISTS livestock_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  image TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS livestock_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  livestock_type_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  image TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(livestock_type_id, name),
  UNIQUE(livestock_type_id, slug),
  FOREIGN KEY (livestock_type_id) REFERENCES livestock_types(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS livestock_breeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  livestock_type_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  image TEXT,
  featured INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(livestock_type_id, name),
  UNIQUE(livestock_type_id, slug),
  FOREIGN KEY (livestock_type_id) REFERENCES livestock_types(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS livestock_breed_classifications (
  breed_id INTEGER NOT NULL,
  classification_id INTEGER NOT NULL,
  PRIMARY KEY (breed_id, classification_id),
  FOREIGN KEY (breed_id) REFERENCES livestock_breeds(id) ON DELETE CASCADE,
  FOREIGN KEY (classification_id) REFERENCES livestock_classifications(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_livestock_classifications_type ON livestock_classifications(livestock_type_id, display_order, id);
CREATE INDEX IF NOT EXISTS idx_livestock_breeds_type ON livestock_breeds(livestock_type_id, featured, display_order, name);
CREATE INDEX IF NOT EXISTS idx_animals_livestock_type ON animals(livestock_type);
CREATE INDEX IF NOT EXISTS idx_animals_livestock_classification ON animals(livestock_classification);
CREATE INDEX IF NOT EXISTS idx_animals_breed_id ON animals(breed_id);
`);

addColumn('livestock_breeds', 'display_order', 'INTEGER NOT NULL DEFAULT 0');

// Keep the taxonomy idempotent so existing Railway databases receive new
// livestock types, classifications and breeds without duplicating existing data.
const typeSeed = [
  { name: 'Cattle', order: 0, description: 'Explore dairy, beef, and dual-purpose cattle breeds.' },
  { name: 'Sheep', order: 1, description: 'Explore meat, hair/meat, and wool sheep breeds.' },
  { name: 'Goats', order: 2, description: 'Explore meat and other goat breeds available through Delamere Farm.' }
];

const classificationSeed = {
  Cattle: [
    { name: 'Dairy', breeds: ['Friesian / Holstein', 'Ayrshire', 'Jersey', 'Guernsey', 'Girolando', 'Sahiwal'] },
    { name: 'Beef', breeds: ['Boran', 'Brahman'] },
    { name: 'Dual-purpose', breeds: ['Sahiwal', 'Fleckvieh'] }
  ],
  Sheep: [
    { name: 'Meat', breeds: ['Dorper', 'White Dorper', 'Red Maasai', 'Hampshire', 'Dormer'] },
    { name: 'Hair/Meat', breeds: ['Red Maasai', 'Dorper'] },
    { name: 'Wool', breeds: ['Merino'] }
  ],
  Goats: [
    { name: 'Meat', breeds: ['Boer', 'Kalahari Red'] }
  ]
};

const typeInsert = db.prepare('INSERT OR IGNORE INTO livestock_types (name, slug, description, display_order) VALUES (?, ?, ?, ?)');
const classInsert = db.prepare('INSERT OR IGNORE INTO livestock_classifications (livestock_type_id, name, slug, description, display_order) VALUES (?, ?, ?, ?, ?)');
const breedInsert = db.prepare('INSERT OR IGNORE INTO livestock_breeds (livestock_type_id, name, slug, description, featured, display_order) VALUES (?, ?, ?, ?, 0, ?)');
const linkInsert = db.prepare('INSERT OR IGNORE INTO livestock_breed_classifications (breed_id, classification_id) VALUES (?, ?)');

db.transaction(() => {
  for (const typeData of typeSeed) {
    typeInsert.run(typeData.name, slugify(typeData.name), typeData.description, typeData.order);
    const type = db.prepare('SELECT id FROM livestock_types WHERE name=?').get(typeData.name);
    const classes = classificationSeed[typeData.name] || [];

    classes.forEach((classification, classIndex) => {
      classInsert.run(type.id, classification.name, slugify(classification.name), `${classification.name} ${typeData.name.toLowerCase()} breeds.`, classIndex);
      const classRow = db.prepare('SELECT id FROM livestock_classifications WHERE livestock_type_id=? AND name=?').get(type.id, classification.name);

      classification.breeds.forEach((breedName, breedIndex) => {
        breedInsert.run(type.id, breedName, slugify(breedName), `${breedName} livestock breed.`, breedIndex);
        const breed = db.prepare('SELECT id FROM livestock_breeds WHERE livestock_type_id=? AND name=?').get(type.id, breedName);
        linkInsert.run(breed.id, classRow.id);
      });
    });
  }
})();

// Initial individual animal catalogue requested for the admin area.
// These records are intentionally photo-free so staff can add the real farm
// photographs from Admin > Livestock > Animals after deployment.
const animalSeed = [
  ...Array.from({ length: 5 }, (_, i) => ({ name: `Friesian Dairy Cow ${i + 1}`, type: 'Cattle', classification: 'Dairy', breed: 'Friesian / Holstein', category: 'Dairy Cattle', sex: 'Female' })),
  ...Array.from({ length: 3 }, (_, i) => ({ name: `Jersey Dairy Cow ${i + 1}`, type: 'Cattle', classification: 'Dairy', breed: 'Jersey', category: 'Dairy Cattle', sex: 'Female' })),
  ...Array.from({ length: 2 }, (_, i) => ({ name: `Girolando Dairy Cow ${i + 1}`, type: 'Cattle', classification: 'Dairy', breed: 'Girolando', category: 'Dairy Cattle', sex: 'Female' })),
  ...Array.from({ length: 2 }, (_, i) => ({ name: `Guernsey Dairy Cow ${i + 1}`, type: 'Cattle', classification: 'Dairy', breed: 'Guernsey', category: 'Dairy Cattle', sex: 'Female' })),
  ...Array.from({ length: 3 }, (_, i) => ({ name: `Sahiwal Cattle ${i + 1}`, type: 'Cattle', classification: 'Dual-purpose', breed: 'Sahiwal', category: 'Cattle', sex: 'Female' })),
  ...Array.from({ length: 4 }, (_, i) => ({ name: `Ayrshire Dairy Cow ${i + 1}`, type: 'Cattle', classification: 'Dairy', breed: 'Ayrshire', category: 'Dairy Cattle', sex: 'Female' })),
  ...Array.from({ length: 5 }, (_, i) => ({ name: `Boran Cattle ${i + 1}`, type: 'Cattle', classification: 'Beef', breed: 'Boran', category: 'Beef Cattle', sex: 'Female' })),
  ...Array.from({ length: 5 }, (_, i) => ({ name: `Brahman Cattle ${i + 1}`, type: 'Cattle', classification: 'Beef', breed: 'Brahman', category: 'Beef Cattle', sex: 'Female' })),
  ...Array.from({ length: 5 }, (_, i) => ({ name: `Fleckvieh Cattle ${i + 1}`, type: 'Cattle', classification: 'Dual-purpose', breed: 'Fleckvieh', category: 'Dual-purpose Cattle', sex: 'Female' })),
  ...Array.from({ length: 4 }, (_, i) => ({ name: `Dormer Sheep ${i + 1}`, type: 'Sheep', classification: 'Meat', breed: 'Dormer', category: 'Meat Sheep', sex: 'Female' })),
  ...Array.from({ length: 3 }, (_, i) => ({ name: `Red Maasai Sheep ${i + 1}`, type: 'Sheep', classification: 'Hair/Meat', breed: 'Red Maasai', category: 'Sheep', sex: 'Female' })),
  ...Array.from({ length: 4 }, (_, i) => ({ name: `Hampshire Sheep ${i + 1}`, type: 'Sheep', classification: 'Meat', breed: 'Hampshire', category: 'Meat Sheep', sex: 'Female' })),
  ...Array.from({ length: 5 }, (_, i) => ({ name: `Boer Goat ${i + 1}`, type: 'Goats', classification: 'Meat', breed: 'Boer', category: 'Meat Goats', sex: 'Female' })),
  ...Array.from({ length: 2 }, (_, i) => ({ name: `Kalahari Red Goat ${i + 1}`, type: 'Goats', classification: 'Meat', breed: 'Kalahari Red', category: 'Meat Goats', sex: 'Female' }))
];

const animalInsert = db.prepare(`
  INSERT OR IGNORE INTO animals
    (name, slug, category, breed, description, image, availability, featured, livestock_type, livestock_classification, breed_id, sex, gender, display_order)
  VALUES (?, ?, ?, ?, ?, NULL, 'Available', 0, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const animal of animalSeed) {
    const breed = db.prepare('SELECT id FROM livestock_breeds WHERE livestock_type_id=(SELECT id FROM livestock_types WHERE name=?) AND name=?').get(animal.type, animal.breed);
    if (!breed) continue;
    const description = `${animal.name} — ${animal.breed} ${animal.type.toLowerCase()} listed by Delamere Farm. Update the description, availability and other details from the admin area.`;
    animalInsert.run(
      animal.name,
      slugify(animal.name),
      animal.category,
      animal.breed,
      description,
      animal.type,
      animal.classification,
      breed.id,
      animal.sex,
      animal.sex,
      animalSeed.indexOf(animal) + 1
    );
  }
})();

// Assign reviewed repository photos without overwriting any photo that staff have
// already attached in Admin. Photos are matched by the breed classification we
// established during the visual review. Extra photos remain in the repository
// for later gallery/individual-photo use rather than being misassigned.
const reviewedStaticPhotos = {
  'Friesian / Holstein': ['friesian-holstein-01.jfif','friesian-holstein-02.jfif','friesian-holstein-03.jfif'],
  'Ayrshire': ['ayrshire-01.jfif','ayrshire-02.jfif'],
  'Jersey': ['jersey-01.jfif','jersey-02.jfif'],
  'Guernsey': ['guernsey-01.jfif'],
  'Girolando': ['girolando-01.jfif','girolando-02.jfif'],
  'Sahiwal': Array.from({ length: 10 }, (_, i) => `sahiwal-${String(i + 1).padStart(2, '0')}.jfif`),
  'Boran': ['boran-01.jfif'],
  'Brahman': Array.from({ length: 5 }, (_, i) => `brahman-${String(i + 1).padStart(2, '0')}.jfif`),
  'Fleckvieh': Array.from({ length: 8 }, (_, i) => `fleckvieh-${String(i + 1).padStart(2, '0')}.jfif`),
  'Dorper': Array.from({ length: 10 }, (_, i) => `dorper-${String(i + 1).padStart(2, '0')}.jfif`),
  'Hampshire': ['hampshire-01.jfif','hampshire-02.jfif','hampshire-03.jfif'],
  'Red Maasai': ['red-maasai-01.jfif','red-maasai-02.jfif','red-maasai-04.jfif','red-maasai-05.jfif','red-maasai-06.jfif','red-maasai-07.jfif'],
  'Boer': Array.from({ length: 5 }, (_, i) => `boer-${String(i + 1).padStart(2, '0')}.jfif`),
  'Kalahari Red': ['kalahari-red-01.jfif']
};

const breedPhotoFolders = {
  'Friesian / Holstein': 'cattle/friesian-holstein',
  'Ayrshire': 'cattle/ayrshire',
  'Jersey': 'cattle/jersey',
  'Guernsey': 'cattle/guernsey',
  'Girolando': 'cattle/girolando',
  'Sahiwal': 'cattle/sahiwal',
  'Boran': 'cattle/boran',
  'Brahman': 'cattle/brahman',
  'Fleckvieh': 'cattle/fleckvieh',
  'Dorper': 'sheep/dorper',
  'Hampshire': 'sheep/hampshire',
  'Red Maasai': 'sheep/red-maasai',
  'Boer': 'goats/boer',
  'Kalahari Red': 'goats/kalahari-red'
};

db.transaction(() => {
  const findBreed = db.prepare('SELECT id FROM livestock_breeds WHERE name=? LIMIT 1');
  const getAnimals = db.prepare('SELECT id FROM animals WHERE breed_id=? AND (image IS NULL OR image=\'\') ORDER BY display_order,id');
  const setAnimalImage = db.prepare('UPDATE animals SET image=? WHERE id=? AND (image IS NULL OR image=\'\')');
  const setBreedImage = db.prepare('UPDATE livestock_breeds SET image=? WHERE id=? AND (image IS NULL OR image=\'\')');

  for (const [breedName, filenames] of Object.entries(reviewedStaticPhotos)) {
    const breed = findBreed.get(breedName);
    if (!breed || !filenames.length) continue;

    const folder = breedPhotoFolders[breedName];
    const firstPhoto = `/animal-photos/${folder}/${filenames[0]}`;
    setBreedImage.run(firstPhoto, breed.id);

    const animals = getAnimals.all(breed.id);
    const limit = Math.min(animals.length, filenames.length);
    for (let i = 0; i < limit; i += 1) {
      const image = `/animal-photos/${folder}/${filenames[i]}`;
      setAnimalImage.run(image, animals[i].id);
    }
  }
})();

function getTypes() { return db.prepare('SELECT * FROM livestock_types ORDER BY display_order, name').all(); }
function getType(slug) { return db.prepare('SELECT * FROM livestock_types WHERE slug=?').get(slug); }
function getClassifications(typeId) { return db.prepare('SELECT * FROM livestock_classifications WHERE livestock_type_id=? ORDER BY display_order, name').all(typeId); }
function getAllClassifications() { return db.prepare('SELECT c.*, t.name livestock_type_name FROM livestock_classifications c JOIN livestock_types t ON t.id=c.livestock_type_id ORDER BY t.display_order,c.display_order,c.name').all(); }
function getClassification(typeId, slug) { return db.prepare('SELECT * FROM livestock_classifications WHERE livestock_type_id=? AND slug=?').get(typeId, slug); }
function getBreedsForType(typeId) { return db.prepare('SELECT * FROM livestock_breeds WHERE livestock_type_id=? ORDER BY featured DESC, display_order, name').all(typeId); }
function getAllBreeds() { return db.prepare('SELECT b.*, t.name livestock_type_name FROM livestock_breeds b JOIN livestock_types t ON t.id=b.livestock_type_id ORDER BY t.display_order,b.featured DESC,b.display_order,b.name').all(); }
function getBreedsForClassification(classificationId) { return db.prepare(`SELECT b.* FROM livestock_breeds b JOIN livestock_breed_classifications bc ON bc.breed_id=b.id WHERE bc.classification_id=? ORDER BY b.featured DESC,b.display_order,b.name`).all(classificationId); }
function getBreed(typeId, slug) { return db.prepare('SELECT * FROM livestock_breeds WHERE livestock_type_id=? AND slug=?').get(typeId, slug); }
function getClassificationsForBreed(breedId) { return db.prepare(`SELECT c.*, t.name livestock_type_name FROM livestock_classifications c JOIN livestock_breed_classifications bc ON bc.classification_id=c.id JOIN livestock_types t ON t.id=c.livestock_type_id WHERE bc.breed_id=? ORDER BY t.display_order,c.display_order,c.name`).all(breedId); }

module.exports = { getTypes, getType, getClassifications, getAllClassifications, getClassification, getBreedsForType, getAllBreeds, getBreedsForClassification, getBreed, getClassificationsForBreed };
