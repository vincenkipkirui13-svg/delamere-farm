const db = require('../src/db/database');
const slugify = require('../src/utils/slugify');

const animals = [
  { name: 'Friesian Dairy Cow', category: 'Dairy Cattle', breed: 'Friesian', age: '3 Years', gender: 'Female', description: 'A healthy dairy cow suitable for customers looking for quality livestock.', image: null, availability: 'Available', featured: 1 },
  { name: 'Ayrshire Dairy Cow', category: 'Dairy Cattle', breed: 'Ayrshire', age: '2 Years', gender: 'Female', description: 'A well-presented dairy animal with a strong farm profile.', image: null, availability: 'Available', featured: 1 },
  { name: 'Beef Heifer', category: 'Beef Cattle', breed: 'Beef Cross', age: '2 Years', gender: 'Female', description: 'Quality beef cattle presented for customer inquiries.', image: null, availability: 'Available', featured: 1 },
  { name: 'Young Calf', category: 'Calves', breed: 'Dairy Cross', age: '8 Months', gender: 'Female', description: 'A young calf available for customers seeking livestock.', image: null, availability: 'Available', featured: 0 }
];
const dairy = [
  { name: 'Fresh Farm Milk', description: 'Fresh milk from the farm, presented as part of our dairy offering.', availability: 'Available', featured: 1 },
  { name: 'Farm Yogurt', description: 'A creamy dairy product made for customers who value quality farm produce.', availability: 'Available', featured: 1 }
];
const faqs = [
  ['How can I inquire about an animal?', 'Open the animal details page and select Inquire About This Animal. The contact form will automatically identify the animal you selected.'],
  ['Can I inquire about dairy products?', 'Yes. Open the Dairy section, choose a product, and use the inquiry button to contact Delamere Farm.'],
  ['Do I pay online through the website?', 'No. The website is designed for viewing livestock and dairy products and sending inquiries. The Delamere Farm team will guide you on the next steps.'],
  ['How will Delamere Farm respond to my inquiry?', 'The farm team can review your inquiry through the website administration area and contact you using the phone number or email you provide.'],
  ['Can the farm update animals and products?', 'Yes. Authorized staff can add, edit, mark availability, and upload photographs through the administration area.']
];

for (const animal of animals) {
  db.prepare(`INSERT OR IGNORE INTO animals (name, slug, category, breed, age, gender, description, image, availability, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(animal.name, slugify(animal.name), animal.category, animal.breed, animal.age, animal.gender, animal.description, animal.image, animal.availability, animal.featured);
}
for (const product of dairy) {
  db.prepare(`INSERT OR IGNORE INTO dairy_products (name, slug, description, image, availability, featured)
    VALUES (?, ?, ?, ?, ?, ?)`).run(product.name, slugify(product.name), product.description, null, product.availability, product.featured);
}
for (let i = 0; i < faqs.length; i += 1) {
  db.prepare(`INSERT OR IGNORE INTO faqs (question, answer, display_order, active) VALUES (?, ?, ?, 1)`).run(faqs[i][0], faqs[i][1], i + 1);
}

console.log('Demo animals, dairy products, and FAQs loaded.');
