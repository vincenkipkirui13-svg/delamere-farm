const db = require('../src/db/database');

const target = 2544;

const names = [
  // Luo
  'Emmanuel Oduor','Brian Otieno','Kevin Odhiambo','Collins Onyango',
  'Dennis Ochieng','Mercy Akinyi','Sharon Achieng','Faith Atieno',
  'Jane Auma','George Okoth','Victor Ouma','Brenda Adhiambo',
  'Ian Omondi','Diana Awino','Martin Oloo','Linda Akoth',
  'Eric Onyango','Susan Achieng','Mark Ochieng','Cynthia Akinyi',

  // Kikuyu
  'Jane Wanjiru','Mercy Wambui','Kevin Mwangi','Ian Kamau',
  'Ruth Njeri','Brian Kariuki','Faith Nyambura','David Kimani',
  'Sharon Wangari','Peter Maina','Ann Muthoni','James Njuguna',
  'Lucy Wairimu','Michael Karanja','Esther Nyokabi','Daniel Gikonyo',
  'Mary Wanjiku','Samuel Muchiri','Grace Wangui','Joseph Kiragu',

  // Kalenjin
  'Kelvin Kiplangat','Dennis Kiptoo','Faith Chebet','Sharon Jepchirchir',
  'Collins Kiplagat','Mercy Chepkoech','Brian Kibet','Lilian Chepkirui',
  'Victor Kiprono','Janet Cherotich','Mark Kiptum','Irene Jepkoech',
  'David Bett','Susan Chepkemoi','Edwin Kiprotich','Mercy Chepngeno',
  'Ronald Kurgat','Stella Chebet','Peter Kipchumba','Caroline Jelagat',

  // Luhya
  'Brian Wekesa','Mercy Nasimiyu','Kevin Wafula','Sharon Nekesa',
  'David Wanyonyi','Faith Nabwire','Martin Barasa','Jane Nanjala',
  'Collins Wamalwa','Ruth Khisa','Victor Were','Lilian Wanyama',
  'Dennis Simiyu','Mary Namisi','George Juma','Esther Nasambu',
  'Ian Wekesa','Brenda Wanjala','Peter Lusweti','Cynthia Nabwire',

  // Kisii
  'Brian Omwenga','Mercy Moraa','Kevin Nyamongo','Sharon Kerubo',
  'David Onchangu','Faith Nyanchera','Dennis Ogega','Jane Bosibori',
  'Victor Nyaboke','Irene Kemunto','Mark Mogaka','Esther Moraa',
  'Collins Onsongo','Ruth Kwamboka','George Nyakundi','Susan Moraa',
  'Eric Osebe','Brenda Kerubo','Peter Omwenga','Caroline Nyanchera',

  // Kamba
  'Brian Mutuku','Mercy Nduku','Kevin Musyoki','Sharon Mbithe',
  'David Mwende','Faith Kavita','Dennis Kioko','Jane Mutheu',
  'Victor Mumo','Irene Wambua','Mark Kyalo','Esther Nzula',
  'Collins Muema','Ruth Syokau','George Nzioki','Susan Kalunda',
  'Eric Musau','Brenda Ndinda','Peter Makau','Caroline Muthoni',

  // Coastal / Swahili
  'Zawadi Asha','Asha Salim','Fatuma Ali','Hassan Juma',
  'Amina Said','Salim Abdalla','Zainab Omar','Yusuf Hassan',
  'Mariam Ali','Abdullahi Juma','Halima Said','Ahmed Salim',
  'Saida Hassan','Mohamed Juma','Nadia Omar','Ali Abdalla',
  'Rehema Said','Ibrahim Hassan','Khadija Ali','Hamisi Juma',

  // Meru / Embu
  'Brian Muriuki','Mercy Kaari','Kevin Muriithi','Sharon Kendi',
  'David Kirimi','Faith Muthoni','Dennis Mugambi','Jane Nkatha',
  'Victor Kinoti','Irene Kagwiria','Mark Gitonga','Esther Ciambaka',
  'Collins Kithinji','Ruth Karimi','George Murithi','Susan Nkirote',
  'Eric Mutuma','Brenda Mwendwa','Peter Mugambi','Caroline Kendi'
];

const notes = [
  'Great service and helpful communication.',
  'The team was very helpful and professional.',
  'I received a quick response to my inquiry.',
  'Very good experience from start to finish.',
  'The information provided was clear and useful.',
  'Excellent customer service.',
  'I was impressed by the quality of service.',
  'Friendly team and smooth communication.',
  'Very helpful when I needed more information.',
  'Professional service and good communication.',
  'The response was quick and informative.',
  'A good experience overall.',
  'Helpful staff and clear information.',
  'I would gladly recommend the service.',
  'Everything was handled professionally.'
];

const insert = db.prepare(`
  INSERT INTO reviews (customer_name, rating, review_text, published)
  VALUES (?, ?, ?, 1)
`);

const count = db.prepare(`
  SELECT COUNT(*) AS count FROM reviews
`).get().count;

if (count > 0) {
  console.log(`Existing reviews found: ${count}`);
  console.log('Removing existing sample reviews...');
  db.prepare('DELETE FROM reviews').run();
}

const transaction = db.transaction(() => {
  for (let i = 0; i < target; i++) {
    const name = names[i % names.length];
    const note = notes[i % notes.length];

    // Mostly 5-star reviews with occasional 4-star reviews.
    const rating = ((i + 1) % 13 === 0) ? 4 : 5;

    insert.run(name, rating, note);
  }
});

transaction();

const total = db.prepare(`
  SELECT COUNT(*) AS count FROM reviews
`).get().count;

const published = db.prepare(`
  SELECT COUNT(*) AS count FROM reviews WHERE published = 1
`).get().count;

console.log('');
console.log(`TOTAL_REVIEWS=${total}`);
console.log(`PUBLISHED_REVIEWS=${published}`);
console.log('');

