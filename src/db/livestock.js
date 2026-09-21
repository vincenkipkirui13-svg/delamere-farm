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

// Taxonomy tables are intentionally separate from individual animal listings.
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

if (!db.prepare('SELECT 1 FROM livestock_types LIMIT 1').get()) {
  const typeSeed = [
    { name: 'Cattle', order: 0, description: 'Explore dairy, beef, and dual-purpose cattle breeds.' },
    { name: 'Sheep', order: 1, description: 'Explore meat, hair/meat, and wool sheep breeds.' }
  ];
  const classificationSeed = {
    Cattle: [
      { name: 'Dairy', breeds: ['Friesian / Holstein', 'Ayrshire', 'Jersey', 'Guernsey', 'Girolando', 'Sahiwal'] },
      { name: 'Beef', breeds: ['Boran', 'Brahman'] },
      { name: 'Dual-purpose', breeds: ['Sahiwal', 'Fleckvieh'] }
    ],
    Sheep: [
      { name: 'Meat', breeds: ['Dorper', 'White Dorper', 'Red Maasai', 'Hampshire'] },
      { name: 'Hair/Meat', breeds: ['Red Maasai', 'Dorper'] },
      { name: 'Wool', breeds: ['Merino'] }
    ]
  };
  const typeInsert = db.prepare('INSERT INTO livestock_types (name, slug, description, display_order) VALUES (?, ?, ?, ?)');
  const classInsert = db.prepare('INSERT INTO livestock_classifications (livestock_type_id, name, slug, description, display_order) VALUES (?, ?, ?, ?, ?)');
  const breedInsert = db.prepare('INSERT INTO livestock_breeds (livestock_type_id, name, slug, description, featured, display_order) VALUES (?, ?, ?, ?, 0, ?)');
  const linkInsert = db.prepare('INSERT OR IGNORE INTO livestock_breed_classifications (breed_id, classification_id) VALUES (?, ?)');
  db.transaction(() => {
    for (const typeData of typeSeed) {
      const typeResult = typeInsert.run(typeData.name, slugify(typeData.name), typeData.description, typeData.order);
      const classes = classificationSeed[typeData.name] || [];
      classes.forEach((classification, classIndex) => {
        const classResult = classInsert.run(typeResult.lastInsertRowid, classification.name, slugify(classification.name), `${classification.name} ${typeData.name.toLowerCase()} breeds.`, classIndex);
        classification.breeds.forEach((breedName, breedIndex) => {
          let breed = db.prepare('SELECT id FROM livestock_breeds WHERE livestock_type_id=? AND name=?').get(typeResult.lastInsertRowid, breedName);
          if (!breed) {
            const result = breedInsert.run(typeResult.lastInsertRowid, breedName, slugify(breedName), `${breedName} livestock breed.`, breedIndex);
            breed = { id: result.lastInsertRowid };
          }
          linkInsert.run(breed.id, classResult.lastInsertRowid);
        });
      });
    }
  })();
}

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
