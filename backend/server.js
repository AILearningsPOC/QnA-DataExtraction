'use strict';
// ═══════════════════════════════════════════════════════════════
// Q&A Automation — Mock Retailer API Server
// Deploy to Railway · Works standalone with in-memory data
// Optionally connects to Supabase for persistence
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors    = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

let XLSX;
try { XLSX = require('xlsx'); } catch(e) { console.warn('xlsx not found — Excel export disabled'); }

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'] }));
app.use(express.json());

// Request logger
const LOGS = [];
app.use((req, _res, next) => {
  LOGS.unshift({
    id: uuidv4(), method: req.method, path: req.path,
    query: req.query, body: req.method !== 'GET' ? req.body : undefined,
    timestamp: new Date().toISOString(), ip: req.ip || req.connection.remoteAddress
  });
  if (LOGS.length > 1000) LOGS.length = 1000;
  next();
});

// ─── RETAILERS ────────────────────────────────────────────────
const RETAILERS = [
  { id:'bestbuy', name:'Best Buy',  slug:'bestbuy', theme:'#003087', accent:'#FFE000', text:'#ffffff', base_url: process.env.BESTBUY_URL  || 'https://mock-bestbuy.netlify.app'  },
  { id:'walmart', name:'Walmart',   slug:'walmart', theme:'#0071CE', accent:'#FFC220', text:'#ffffff', base_url: process.env.WALMART_URL  || 'https://mock-walmart.netlify.app'  },
  { id:'amazon',  name:'Amazon',    slug:'amazon',  theme:'#131921', accent:'#FF9900', text:'#ffffff', base_url: process.env.AMAZON_URL   || 'https://mock-amazon.netlify.app'   },
  { id:'costco',  name:'Costco',    slug:'costco',  theme:'#005DAA', accent:'#E31837', text:'#ffffff', base_url: process.env.COSTCO_URL   || 'https://mock-costco.netlify.app'   }
];

// ─── BASE PRODUCTS (shared across retailers with price offsets) ─
const BASE_PRODUCTS = [
  { category:'tv',              title:'Hisense 55" U6 Series MiniLED QLED 4K HDR Smart Fire TV (2025)',    base_price:399.99, rating:4.7, review_count:1247, image:'https://placehold.co/500x420/1a1a2e/white?text=Hisense+55%22+U6+TV',           description:'Mini-LED QLED with Dolby Vision IQ, 120Hz, Game Mode Pro 144Hz, 4K UHD.',            specs:{'Screen Size':'55"','Resolution':'4K UHD 2160p','Refresh Rate':'120Hz (144Hz VRR)','HDR':'Dolby Vision IQ, HDR10+','Platform':'Fire TV','HDMI Ports':'4 (2×HDMI 2.1)','Backlight':'Mini-LED','Wi-Fi':'Wi-Fi 6, Bluetooth 5.0'} },
  { category:'tv',              title:'Hisense 65" U8 Series MiniLED QLED 4K Smart Google TV (2025)',      base_price:699.99, rating:4.8, review_count:892,  image:'https://placehold.co/500x420/0d1b2a/white?text=Hisense+65%22+U8+TV',           description:'1500-nit Mini-LED Pro, 144Hz, Quantum Dot Color, Hands-Free Voice Control.',         specs:{'Screen Size':'65"','Resolution':'4K UHD 2160p','Refresh Rate':'144Hz VRR','Peak Brightness':'1500 nits','HDR':'Dolby Vision','Platform':'Google TV','HDMI Ports':'4 (2×HDMI 2.1)','Backlight':'Mini-LED Pro'} },
  { category:'refrigerator',   title:'Hisense 26 cu ft French Door Bottom Freezer Refrigerator',          base_price:1299.99,rating:4.5, review_count:434,  image:'https://placehold.co/500x420/2c3e50/white?text=Hisense+French+Door+Fridge',     description:'Counter-depth French door with ice maker, multi-airflow, and stainless finish.',     specs:{'Capacity':'26 cu ft','Type':'French Door','Ice Maker':'Yes','Water Dispenser':'Internal','Energy Star':'Yes','Noise':'38 dB','Finish':'Fingerprint Resistant SS'} },
  { category:'air_cooler',     title:'Hisense 8,000 BTU Portable Air Conditioner with Dehumidifier',       base_price:299.99, rating:4.3, review_count:678,  image:'https://placehold.co/500x420/2980b9/white?text=Hisense+8000+BTU+AC',           description:'3-in-1 cooling, fan and dehumidifier with Wi-Fi app control and Auto mode.',         specs:{'Cooling':'8,000 BTU','Coverage':'Up to 350 sq ft','Modes':'Cool / Fan / Dehumidify','Noise':'53 dB max / 42 dB sleep','Wi-Fi':'Yes','Remote':'Yes','Energy Star':'Yes'} },
  { category:'washing_machine',title:'Hisense 5.0 cu ft Front Load Washer with Steam & Wi-Fi',            base_price:649.99, rating:4.4, review_count:312,  image:'https://placehold.co/500x420/27ae60/white?text=Hisense+Front+Load+Washer',     description:'Steam Wash, 14 cycles, 1400 RPM inverter motor, allergen cycle.',                    specs:{'Capacity':'5.0 cu ft','Type':'Front Load','Max Spin':'1400 RPM','Cycles':'14','Steam':'Yes','Energy Star':'Yes','Wi-Fi':'Yes'} },
  { category:'gas_range',      title:'Hisense 30" 5-Burner Freestanding Gas Range with True Convection',  base_price:549.99, rating:4.6, review_count:289,  image:'https://placehold.co/500x420/7f8c8d/white?text=Hisense+Gas+Range',             description:'18,000 BTU power burner, 5.0 cu ft oven, true convection, self-clean.',              specs:{'Width':'30"','Burners':'5 sealed','Power Burner':'18,000 BTU','Oven':'5.0 cu ft','Convection':'True Convection','Self-Clean':'Yes','Gas Type':'Natural Gas / LP'} },
  { category:'microwave',      title:'Hisense 1.1 cu ft Countertop Microwave with Inverter & Sensor Cook', base_price:89.99,  rating:4.2, review_count:891,  image:'https://placehold.co/500x420/8e44ad/white?text=Hisense+Microwave+1.1cu',      description:'1000W inverter microwave with sensor cooking, 9 auto-programs, and convection.',     specs:{'Capacity':'1.1 cu ft','Wattage':'1000W','Inverter':'Yes','Sensor Cook':'Yes','Turntable':'12.4"','Programs':'9 Auto-Cook','Color':'Stainless Steel'} },
  { category:'home_appliance', title:'Hisense 50-Bottle Dual-Zone Freestanding Wine Cooler',               base_price:199.99, rating:4.5, review_count:445,  image:'https://placehold.co/500x420/2c3e50/white?text=Hisense+Wine+Cooler+50-Bottle', description:'Dual-zone 41–64°F with UV glass, LED interior, and whisper-quiet compressor.',       specs:{'Capacity':'50 Bottles','Zones':'Dual Zone','Temp Range':'41–64°F','UV Glass':'Yes','Interior':'LED Light','Noise':'42 dB','Lock':'Yes'} }
];

// Build 32 products (8 per retailer)
const PRODUCTS = [];
RETAILERS.forEach(r => {
  const priceOff = { bestbuy:1.00, walmart:0.95, amazon:0.98, costco:0.92 }[r.id];
  BASE_PRODUCTS.forEach((bp, i) => {
    const sku = `${r.id.toUpperCase().slice(0,2)}-${bp.category.toUpperCase().slice(0,3)}-${String(i+1).padStart(3,'0')}`;
    PRODUCTS.push({
      id: uuidv4(), retailer_id: r.id, retailer_name: r.name,
      sku, ...bp,
      price: Math.round(bp.base_price * priceOff * 100) / 100,
      product_url: `${r.base_url}/product/${sku}`,
      created_at: new Date().toISOString()
    });
  });
});

// ─── QUESTION + ANSWER BANKS ──────────────────────────────────
const QB = {
  tv: [
    { q:'Does this TV support Dolby Vision?',               a:'Yes — Dolby Vision IQ and HDR10+ Adaptive are both supported for premium HDR from Netflix, Disney+ and Apple TV+.' },
    { q:'What is the native refresh rate?',                 a:'The native panel is 120Hz. Game Mode Pro supports up to 144Hz via HDMI 2.1 with VRR enabled.' },
    { q:'Does it support HDMI 2.1?',                       a:'Yes! Ports 3 and 4 are full-bandwidth HDMI 2.1, supporting 4K@120Hz, VRR, ALLM and eARC.' },
    { q:'How many HDMI ports does it have?',               a:'4 HDMI ports total — 2× HDMI 2.0 and 2× HDMI 2.1 for high-bandwidth gaming and home theatre.' },
    { q:'Can I use this with a PlayStation 5?',            a:'Absolutely. HDMI 2.1 ports support PS5 at 4K 120fps with VRR for smooth, tear-free gameplay.' },
    { q:'Does it have a built-in camera?',                 a:'No built-in camera. A compatible USB webcam can be connected for video calls on supported apps.' },
    { q:'What streaming apps are pre-installed?',          a:'Netflix, Prime Video, Disney+, Apple TV+, Hulu and YouTube come pre-installed out of the box.' },
    { q:'Is it compatible with Apple AirPlay?',            a:'Yes, AirPlay 2 is fully supported for wireless screen mirroring and audio from Apple devices.' },
    { q:'What is the response time for gaming?',           a:'Input lag in Game Mode measures approximately 6.9ms at 4K 120Hz for near-instant responsiveness.' },
    { q:'Does it support Bluetooth headphones?',           a:'Yes, Bluetooth 5.0 is built in for pairing wireless headphones, soundbars and audio devices.' },
    { q:'Is a wall mount included?',                       a:'No wall mount is included. The TV uses VESA 200×200mm — compatible mounts are sold separately.' },
    { q:'Does it support the Spectrum TV app?',            a:'Yes! The Spectrum TV app is available in the app store and supports live TV and on-demand.' },
    { q:'Can I connect a soundbar?',                       a:'Yes — via HDMI ARC/eARC on port 3, optical audio out, or Bluetooth for wireless connection.' },
    { q:'What is the peak brightness?',                    a:'This TV achieves up to 1000 nits peak brightness with Mini-LED local dimming fully activated.' },
    { q:'Does it have a sleep timer?',                     a:'Yes, sleep timer is in Settings with increments from 5 minutes up to 240 minutes.' },
    { q:'Is the 4K upscaling good on this TV?',           a:'Yes — the Hisense Hi-View AI Engine Pro upscales HD and FHD content to near-4K quality automatically.' },
    { q:'Does this TV support Google Assistant?',          a:'Yes, Google Assistant is built in for hands-free voice search, smart home control and content discovery.' },
    { q:'Can this TV be used as a PC monitor?',           a:'Yes! Use HDMI or USB-C (if available) and enable PC Mode in the picture settings for 1:1 pixel mapping.' },
  ],
  refrigerator: [
    { q:'How noisy is this refrigerator?',                 a:'It operates at just 38 dB — quieter than a whisper. You\'ll barely notice it even in an open plan kitchen.' },
    { q:'Does it have an ice maker?',                      a:'Yes — includes a built-in automatic ice maker producing up to 8 lbs of ice per day in the freezer.' },
    { q:'What is the energy star rating?',                 a:'ENERGY STAR certified, consuming approximately 600 kWh annually — about $72/year at average rates.' },
    { q:'Does the water dispenser require plumbing?',      a:'Yes, a water line connection is required. An installation kit with fittings is included in the box.' },
    { q:'What temperature range is supported?',            a:'Refrigerator: 33–45°F. Freezer: -4 to 8°F. Both sections are independently adjustable via the panel.' },
    { q:'Does it have a door alarm?',                      a:'Yes — an audible alarm sounds if a door is left open for more than 2 minutes to prevent energy waste.' },
    { q:'How much food can it hold?',                      a:'At 26 cu ft, this comfortably stores groceries for a family of 4–5 with space for tall bottles and platters.' },
  ],
  air_cooler: [
    { q:'What room size can this cool effectively?',       a:'Rated for rooms up to 350 square feet — ideal for a large bedroom, home office or small living room.' },
    { q:'How loud is it on the maximum setting?',          a:'Maximum speed reaches 53 dB. On Sleep mode it reduces to 42 dB — quiet enough for sleeping.' },
    { q:'Does it have a dehumidifier mode?',               a:'Yes! Dedicated Dehumidifier mode removes up to 2.6 pints of moisture per hour from the air.' },
    { q:'Can it run on inverter power?',                   a:'Yes, compatible with most inverter generators rated 1,500W or higher with a pure sine wave output.' },
    { q:'Does it need to be vented outside?',              a:'Yes — the exhaust hose must be vented through a window using the window installation kit included.' },
  ],
  washing_machine: [
    { q:'Does it have a steam wash cycle?',                a:'Yes — Steam Wash reaches 248°F to penetrate fabrics deeply and eliminate 99.9% of bacteria and allergens.' },
    { q:'Can it run on inverter power?',                   a:'We recommend a minimum 3,000W pure sine wave inverter for reliable and safe operation.' },
    { q:'What is the maximum spin speed?',                 a:'1400 RPM — significantly reduces residual moisture and cuts dryer time by up to 25%.' },
    { q:'How much water does it use per cycle?',           a:'Sensor-based load detection uses only 13–14 gallons per cycle — 40% less than typical top-loaders.' },
    { q:'Does it have a drum light?',                      a:'Yes — an LED drum light illuminates the interior so you can easily spot and retrieve small items.' },
  ],
  gas_range: [
    { q:'Does it require professional installation?',      a:'Yes — gas appliance connections must be made by a licensed gas technician. Professional installation is required.' },
    { q:'What is the BTU of the power burner?',           a:'The power burner outputs 18,000 BTU for rapid boiling, plus a 5,000 BTU simmer burner for precision cooking.' },
    { q:'Does it have a convection oven?',                 a:'Yes! True Convection includes a dedicated third heating element for even, consistent baking and roasting.' },
    { q:'Can it use LP gas?',                             a:'Yes — ships set for natural gas. An LP conversion kit (sold separately, ~$25) enables propane use.' },
    { q:'What size baking sheet fits?',                    a:'The 5.0 cu ft cavity fits two standard 17×25 half-sheet pans side by side — plenty of room.' },
  ],
  microwave: [
    { q:'Does it support convection baking?',             a:'Yes — Combination Convection + Microwave mode delivers crispy, browned results in significantly less time.' },
    { q:'What wattage is this microwave?',                 a:'1000 watts across all 10 power levels via Inverter Technology for consistent, even heating.' },
    { q:'Does it have sensor cooking?',                    a:'Yes! Sensor cooking detects steam from food and automatically adjusts time and power for perfect results.' },
    { q:'Can it fit a 12-inch pizza?',                    a:'Yes — the 12.4-inch glass turntable accommodates a standard 12-inch frozen or fresh pizza with ease.' },
    { q:'Does it have an inverter?',                       a:'Yes — Inverter Technology maintains consistent power levels at all settings for even defrosting and cooking.' },
  ],
  home_appliance: [
    { q:'What temperature range does it maintain?',       a:'Upper zone: 54–64°F for red wines. Lower zone: 41–54°F for whites and sparkling. Both independently set.' },
    { q:'How many bottles does it hold?',                 a:'Up to 50 standard 750ml Bordeaux-style bottles across 14 chrome wire shelves — plenty for any collector.' },
    { q:'Does it have dual temperature zones?',           a:'Yes — dual independent zones let you store both red and white wines at their ideal serving temperatures.' },
    { q:'How loud is the cooling system?',                a:'The compressor operates at just 42 dB — quieter than a normal conversation, ideal for kitchen or living room.' },
    { q:'Does it have UV-protective glass?',              a:'Yes — tempered UV-protective glass blocks harmful light that degrades wine quality and fades labels over time.' },
  ]
};

const USERNAMES = [
  'TechLover99','HomeImprover','BudgetBuyer','John_T','Sarah_M','GadgetGuru',
  'SmartShopper','CoolDad2024','KitchenChef','MovieNight','GamingFan',
  'EnergyConscious','FirstTimeBuyer','ProInstaller','FamilyOf5','WineEnthusiast',
  'QuietHomeOwner','StreamingAddict','DIYKing','SmartHomeFan','CollegeDorm',
  'NewHomeowner','TechSavvyMom','RetiredEngineer','BudgetBuyer22','Reviewer2024',
  'AppliancePro','AudiophileX','CookingLover','EcoWarrior'
];

const SENTIMENTS = ['positive','neutral','neutral','negative'];

// ─── IN-MEMORY QUESTIONS STORE ────────────────────────────────
const QUESTIONS = [];

function makeQuestion(product, qa, overrides = {}) {
  const isAnswered = overrides.status ? overrides.status === 'answered' : Math.random() > 0.38;
  const daysAgo = overrides.daysAgo ?? (Math.floor(Math.random() * 75) + 3);
  const askedAt = new Date();
  askedAt.setDate(askedAt.getDate() - daysAgo);
  askedAt.setHours(Math.floor(Math.random()*24), Math.floor(Math.random()*60));
  return {
    id: uuidv4(),
    product_id: product.id,
    retailer_id: product.retailer_id,
    question_text: qa.q,
    asked_by: USERNAMES[Math.floor(Math.random() * USERNAMES.length)],
    asked_at: askedAt.toISOString(),
    status: isAnswered ? 'answered' : 'unanswered',
    ai_generated: overrides.ai_generated ?? false,
    sentiment: SENTIMENTS[Math.floor(Math.random() * SENTIMENTS.length)],
    ai_confidence: Math.round((0.72 + Math.random() * 0.27) * 100) / 100,
    answer: isAnswered ? {
      id: uuidv4(),
      answer_text: qa.a,
      answered_by: 'HisenseExpert',
      answered_at: new Date(askedAt.getTime() + (Math.random() * 5 * 86400000)).toISOString(),
      is_approved: true
    } : null
  };
}

function seedQuestions() {
  PRODUCTS.forEach(product => {
    const bank = QB[product.category] || QB.tv;
    const count = 2; // 2 questions per product on startup
    const shuffled = [...bank].sort(() => Math.random() - 0.5).slice(0, count);
    shuffled.forEach(qa => QUESTIONS.push(makeQuestion(product, qa)));
  });
  console.log(`✅ Seeded ${QUESTIONS.length} questions across ${PRODUCTS.length} products`);
}

// ─── ROUTES ───────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => res.json({
  status: 'ok', uptime: Math.round(process.uptime()),
  products: PRODUCTS.length, questions: QUESTIONS.length,
  answered: QUESTIONS.filter(q=>q.status==='answered').length,
  timestamp: new Date().toISOString()
}));

// API docs
app.get('/api', (_req, res) => res.json({
  name: 'Q&A Automation Mock Retailer API v1.0',
  endpoints: [
    'GET  /api/health',
    'GET  /api/retailers',
    'GET  /api/products?retailer=&category=',
    'GET  /api/products/:id',
    'GET  /api/products/:id/questions?status=&sort=newest&page=1&limit=10',
    'POST /api/questions/generate  { product_id, count }',
    'POST /api/questions/add       { product_id, question_text, asked_by }',
    'POST /api/questions/:id/answer { answer_text, answered_by }',
    'GET  /api/questions/:id',
    'GET  /api/admin/stats',
    'GET  /api/admin/questions?retailer=&status=',
    'GET  /api/export/urls    → Excel download',
    'GET  /api/export/qa      → CSV download',
    'GET  /api/logs?limit=100'
  ]
}));

// Retailers
app.get('/api/retailers', (_req, res) => {
  setTimeout(() => res.json({ success:true, data: RETAILERS }), rand(50,150));
});

// Products list
app.get('/api/products', (req, res) => {
  let list = [...PRODUCTS];
  if (req.query.retailer)  list = list.filter(p => p.retailer_id === req.query.retailer);
  if (req.query.category)  list = list.filter(p => p.category    === req.query.category);
  const qCounts = {};
  QUESTIONS.forEach(q => { qCounts[q.product_id] = (qCounts[q.product_id]||0) + 1; });
  list = list.map(p => ({ ...p, question_count: qCounts[p.id] || 0 }));
  setTimeout(() => res.json({ success:true, count:list.length, data:list }), rand(100,300));
});

// Single product
app.get('/api/products/:id', (req, res) => {
  const p = PRODUCTS.find(x => x.id===req.params.id || x.sku===req.params.id);
  if (!p) return res.status(404).json({ success:false, error:'Product not found' });
  const qCount = QUESTIONS.filter(q => q.product_id === p.id).length;
  setTimeout(() => res.json({ success:true, data:{ ...p, question_count:qCount } }), rand(80,200));
});

// Questions for product
app.get('/api/products/:id/questions', (req, res) => {
  const p = PRODUCTS.find(x => x.id===req.params.id || x.sku===req.params.id);
  if (!p) return res.status(404).json({ success:false, error:'Product not found' });
  let qs = QUESTIONS.filter(q => q.product_id === p.id);
  if (req.query.status) qs = qs.filter(q => q.status === req.query.status);
  const sort = req.query.sort || 'newest';
  qs.sort((a,b) => sort==='newest'
    ? new Date(b.asked_at)-new Date(a.asked_at)
    : new Date(a.asked_at)-new Date(b.asked_at));
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 10;
  const total = qs.length;
  const data  = qs.slice((page-1)*limit, page*limit);
  setTimeout(() => res.json({ success:true, total, page, limit, pages:Math.ceil(total/limit), data }), rand(150,450));
});

// Generate random questions
app.post('/api/questions/generate', (req, res) => {
  const { product_id, count=5 } = req.body || {};
  const product = PRODUCTS.find(p => p.id===product_id || p.sku===product_id);
  if (!product) return res.status(404).json({ success:false, error:'Product not found' });
  const bank = QB[product.category] || QB.tv;
  const existing = new Set(QUESTIONS.filter(q=>q.product_id===product.id).map(q=>q.question_text));
  const available = bank.filter(qa => !existing.has(qa.q));
  const pool = available.length ? available : bank;
  const toAdd = [...pool].sort(()=>Math.random()-0.5).slice(0, Math.min(parseInt(count)||5, 20));
  const newQs = toAdd.map(qa => {
    const q = makeQuestion(product, qa, { daysAgo: Math.floor(Math.random()*3), ai_generated:true });
    QUESTIONS.push(q);
    return q;
  });
  res.json({ success:true, generated:newQs.length, data:newQs });
});

// Add manual question
app.post('/api/questions/add', (req, res) => {
  const { product_id, question_text, asked_by } = req.body || {};
  if (!product_id || !question_text) return res.status(400).json({ success:false, error:'product_id and question_text required' });
  const product = PRODUCTS.find(p => p.id===product_id || p.sku===product_id);
  if (!product) return res.status(404).json({ success:false, error:'Product not found' });
  const q = {
    id:uuidv4(), product_id:product.id, retailer_id:product.retailer_id,
    question_text, asked_by:asked_by||'Anonymous', asked_at:new Date().toISOString(),
    status:'unanswered', ai_generated:false, sentiment:'neutral', ai_confidence:0, answer:null
  };
  QUESTIONS.push(q);
  res.json({ success:true, data:q });
});

// Answer a question
app.post('/api/questions/:id/answer', (req, res) => {
  const q = QUESTIONS.find(x => x.id===req.params.id);
  if (!q) return res.status(404).json({ success:false, error:'Question not found' });
  const { answer_text, answered_by } = req.body || {};
  if (!answer_text) return res.status(400).json({ success:false, error:'answer_text required' });
  q.answer = { id:uuidv4(), answer_text, answered_by:answered_by||'HisenseExpert', answered_at:new Date().toISOString(), is_approved:true };
  q.status = 'answered';
  setTimeout(() => res.json({ success:true, data:q }), rand(200,600));
});

// Get single question
app.get('/api/questions/:id', (req, res) => {
  const q = QUESTIONS.find(x => x.id===req.params.id);
  if (!q) return res.status(404).json({ success:false, error:'Question not found' });
  res.json({ success:true, data:q });
});

// Admin stats
app.get('/api/admin/stats', (_req, res) => {
  const stats = {
    total_products: PRODUCTS.length, total_questions: QUESTIONS.length,
    answered:   QUESTIONS.filter(q=>q.status==='answered').length,
    unanswered: QUESTIONS.filter(q=>q.status==='unanswered').length,
    by_retailer: {}
  };
  RETAILERS.forEach(r => {
    const rqs = QUESTIONS.filter(q => q.retailer_id===r.id);
    stats.by_retailer[r.id] = {
      name:r.name, products:PRODUCTS.filter(p=>p.retailer_id===r.id).length,
      questions:rqs.length, answered:rqs.filter(q=>q.status==='answered').length
    };
  });
  res.json({ success:true, data:stats });
});

// Admin questions list
app.get('/api/admin/questions', (req, res) => {
  let qs = [...QUESTIONS];
  if (req.query.retailer) qs = qs.filter(q => q.retailer_id===req.query.retailer);
  if (req.query.status)   qs = qs.filter(q => q.status===req.query.status);
  if (req.query.search)   qs = qs.filter(q => q.question_text.toLowerCase().includes(req.query.search.toLowerCase()));
  qs.sort((a,b) => new Date(b.asked_at)-new Date(a.asked_at));
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 50;
  const total = qs.length;
  res.json({ success:true, total, page, limit, data:qs.slice((page-1)*limit, page*limit) });
});

// Approve answer
app.post('/api/admin/answers/:id/approve', (req, res) => {
  const q = QUESTIONS.find(x => x.answer && x.answer.id===req.params.id);
  if (!q || !q.answer) return res.status(404).json({ success:false, error:'Answer not found' });
  q.answer.is_approved = true;
  res.json({ success:true, data:q });
});

// Bulk generate (admin)
app.post('/api/admin/generate-bulk', (req, res) => {
  const { retailer_id, count_per_product = 3 } = req.body || {};
  let products = [...PRODUCTS];
  if (retailer_id) products = products.filter(p => p.retailer_id===retailer_id);
  let totalGenerated = 0;
  products.forEach(product => {
    const bank = QB[product.category] || QB.tv;
    const n = Math.min(parseInt(count_per_product)||3, bank.length);
    [...bank].sort(()=>Math.random()-0.5).slice(0,n).forEach(qa => {
      const q = makeQuestion(product, qa, { daysAgo:0, ai_generated:true });
      QUESTIONS.push(q);
      totalGenerated++;
    });
  });
  res.json({ success:true, generated:totalGenerated, total_questions:QUESTIONS.length });
});

// Export product URLs — Excel
app.get('/api/export/urls', (_req, res) => {
  if (!XLSX) return res.status(500).json({ success:false, error:'xlsx library unavailable' });
  const rows = PRODUCTS.map(p => ({
    Retailer: p.retailer_name, SKU: p.sku, Category: p.category,
    Product: p.title, Price: `$${p.price}`,
    Rating: p.rating, Reviews: p.review_count,
    'Product URL': p.product_url,
    'Q&A URL': `${p.product_url}#qa`,
    'API Questions URL': `/api/products/${p.id}/questions`
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:10},{wch:22},{wch:16},{wch:55},{wch:10},{wch:8},{wch:9},{wch:55},{wch:55},{wch:40}];
  XLSX.utils.book_append_sheet(wb, ws, 'Product URLs');
  const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=cx_agentx_product_urls.xlsx');
  res.send(buf);
});

// Export Q&A — CSV
app.get('/api/export/qa', (req, res) => {
  let qs = [...QUESTIONS];
  if (req.query.retailer) qs = qs.filter(q => q.retailer_id===req.query.retailer);
  if (req.query.status)   qs = qs.filter(q => q.status===req.query.status);
  const csv = ['ID,Product ID,Retailer,Question,Asked By,Date,Status,Sentiment,AI Confidence,Answer,Answered By,Answered Date']
    .concat(qs.map(q => [
      q.id, q.product_id, q.retailer_id,
      `"${q.question_text.replace(/"/g,"'")}"`,
      q.asked_by, q.asked_at, q.status, q.sentiment, q.ai_confidence,
      `"${q.answer ? q.answer.answer_text.replace(/"/g,"'") : ''}"`,
      q.answer?.answered_by || '', q.answer?.answered_at || ''
    ].join(','))).join('\n');
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename=cx_agentx_qa_export.csv');
  res.send(csv);
});

// Request logs
app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json({ success:true, count:LOGS.length, data:LOGS.slice(0,limit) });
});

// Toggle error simulation
let ERROR_MODE = false;
app.post('/api/admin/error-mode', (req, res) => {
  ERROR_MODE = req.body?.enabled ?? !ERROR_MODE;
  res.json({ success:true, error_mode:ERROR_MODE });
});
app.use((req, res, next) => {
  if (ERROR_MODE && Math.random() < 0.3 && req.path !== '/api/admin/error-mode')
    return res.status(503).json({ success:false, error:'Simulated server error (Error Mode active)' });
  next();
});

// ─── HELPERS ──────────────────────────────────────────────────
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ─── AUTO Q GENERATION (every 3 mins) ────────────────────────
setInterval(() => {
  const product = PRODUCTS[Math.floor(Math.random()*PRODUCTS.length)];
  const bank = QB[product.category] || QB.tv;
  const qa = bank[Math.floor(Math.random()*bank.length)];
  if(!QUESTIONS.find(q=>q.question_text===qa.question&&q.product_id===product.id)){
    QUESTIONS.push(makeQuestion(product, qa, { daysAgo:0, ai_generated:false }));
    console.log(`🔄 Auto-added 1 question — total: ${QUESTIONS.length}`);
  }
}, 10 * 60 * 1000); // every 10 minutes, 1 question

// ─── START ────────────────────────────────────────────────────
seedQuestions();
app.listen(PORT, () => {
  console.log(`\n🚀 Q&A Automation Mock API running on port ${PORT}`);
  console.log(`   Products: ${PRODUCTS.length}  Questions: ${QUESTIONS.length}`);
  console.log(`   Docs: http://localhost:${PORT}/api\n`);
});
