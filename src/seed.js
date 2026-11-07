// Creates the demo business (ABRISHAM boutique) with its real product list.
// Run: npm run seed   — re-running deletes and recreates the demo business.
const crypto = require('node:crypto');
const { openDb } = require('./db');
const { hashPassword } = require('./auth');

const DEMO = {
  slug: 'abrisham',
  name: 'بوتیک ابریشم',
  email: 'demo@abrisham.local',
  description: 'بوتیک لباس زنانه. کالکشن با فصل عوض می‌شود. ارسال رایگان برای هر سفارش، به همهٔ شهرها.',
  tone: 'گرم، کوتاه و محترمانه، مثل فروشندهٔ یک بوتیک کوچک',
  plan: 'pro',
};

// Copied from the live ABRISHAM product table (prices in toman).
const PRODUCTS = [
  ['Sand Bomber Two-Piece', 'Crinkled parachute cotton bomber and balloon trouser, cut to move. Category: Sets.', 4900000],
  ['Brooklyn Appliqué Bomber', 'Cropped bomber in washed sand nylon with hand-finished navy appliqué and contrast piping. Category: Outerwear.', 3200000],
  ['Ivory Lattice Denim Set', 'Raw-hem cropped jacket and high-rise jean in ivory denim with a tonal diamond lattice. Category: Sets.', 4400000],
  ['Midnight Cropped Blazer & Pleat Skirt', 'Sharp-shouldered cropped blazer over a double-belted pleat mini. Category: Tailoring.', 5600000],
  ['Espresso Boat-Neck Top', 'Fine ribbed jersey in deep espresso with a boat neck and long fitted sleeve. Category: Tops.', 1350000],
  ['Champagne Sequin Knit', 'Short-sleeve alpaca-blend knit scattered with clear sequins. Category: Knitwear.', 2450000],
  ['Midnight Sequin Knit', 'Soft-spun black knit flecked with glass sequins, cropped at the hip. Category: Knitwear.', 2450000],
  ['Garnet Sequin Knit', 'Deep red mélange knit with tonal sequins, ribbed collar and cuff. Category: Knitwear.', 2450000],
  ['Jewelled Cable Sweater', 'Cream cable knit set with emerald and smoke crystal clusters. Category: Knitwear.', 3750000],
];

// Only facts the real shop states on its website. Add returns/opening hours once the owner confirms them.
const FAQS = [
  ['هزینهٔ ارسال چقدر است؟', 'ارسال برای همهٔ سفارش‌ها رایگان است.'],
  ['به شهرستان هم ارسال دارید؟', 'بله، به همهٔ شهرهای ایران ارسال داریم.'],
  ['سایز من را از کجا بفهمم؟', 'راهنمای سایز (XXS تا XXL بر اساس اندازه‌های بدن) در صفحهٔ هر محصول در سایت هست. اگر بین دو سایز هستید، اندازه‌هایتان را بفرستید تا کمک کنیم.'],
  ['چطور سفارش بدهم؟', 'همین‌جا در چت محصول را بگویید، بعد نام، شماره موبایل و آدرستان را بفرستید تا سفارش ثبت شود.'],
];

async function seed(db, password) {
  db.prepare('DELETE FROM businesses WHERE slug = ?').run(DEMO.slug); // cascades to products, faqs, orders…
  const hash = await hashPassword(password);
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO businesses (slug, name, email, description, tone, plan, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(DEMO.slug, DEMO.name, DEMO.email, DEMO.description, DEMO.tone, DEMO.plan, hash);
  const businessId = Number(lastInsertRowid);

  const addProduct = db.prepare('INSERT INTO products (business_id, name, description, price) VALUES (?, ?, ?, ?)');
  for (const [name, description, price] of PRODUCTS) addProduct.run(businessId, name, description, price);
  const addFaq = db.prepare('INSERT INTO faqs (business_id, question, answer) VALUES (?, ?, ?)');
  for (const [question, answer] of FAQS) addFaq.run(businessId, question, answer);
  return businessId;
}

if (require.main === module) {
  const password = process.env.DEMO_PASSWORD || crypto.randomBytes(6).toString('base64url');
  const db = openDb(process.env.DB_FILE || 'data/assistant.db');
  seed(db, password).then(() => {
    console.info(`Demo business ready.\n  chat:  /chat/${DEMO.slug}\n  panel: /panel  →  ${DEMO.email} / ${password}`);
  }).catch((err) => {
    console.error('Seeding failed:', err);
    process.exitCode = 1;
  });
}

module.exports = { seed, DEMO };
