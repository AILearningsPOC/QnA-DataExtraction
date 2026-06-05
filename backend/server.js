'use strict';
// Q&A Automation API v2.0 — Supabase + Claude AI
// Updated: 2026-06-04 — store RAG confidence back on question; all tests passing
// Set env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY

const express  = require('express');
const cors     = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

let XLSX;
try { XLSX = require('xlsx'); } catch(e) { console.warn('xlsx not found'); }

const { createClient } = require('@supabase/supabase-js');

const PORT           = process.env.PORT            || 3000;
const SUPABASE_URL   = process.env.SUPABASE_URL    || 'https://gctubfsyefndegomxwew.supabase.co';
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY || '';
const AI_THRESHOLD   = parseFloat(process.env.AI_CONFIDENCE_THRESHOLD || '0.70');

let db = null, DB_READY = false;
if (SUPABASE_URL && SUPABASE_KEY) {
  db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  DB_READY = true;
  console.log('Supabase client initialised');
} else {
  console.warn('SUPABASE_SERVICE_KEY not set — in-memory fallback');
}

const app = express();
app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS,PATCH');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if(req.method==='OPTIONS'){res.sendStatus(204);return;}
  next();
});
app.use(cors({origin:'*',methods:['GET','POST','PUT','DELETE','OPTIONS','PATCH']}));
app.use(express.json({limit:'2mb'}));

const LOGS = [];
app.use((req,_res,next)=>{
  LOGS.unshift({id:uuidv4(),method:req.method,path:req.path,query:req.query,
    body:req.method!=='GET'?req.body:undefined,timestamp:new Date().toISOString()});
  if(LOGS.length>500) LOGS.length=500;
  next();
});

// ─── CENTRALIZED HELPERS ──────────────────────────────────────
// Consistent error response
function errRes(res, status, message) {
  if (!res.headersSent) res.status(status).json({ success: false, error: message });
}

// Safe property accessor
function safe(obj, ...keys) {
  return keys.reduce((cur, k) => (cur != null ? cur[k] : undefined), obj);
}

// Validate required body fields — returns error string or null
function validate(body, ...fields) {
  for (const f of fields) if (!body[f] && body[f] !== 0) return 'Missing required field: ' + f;
  return null;
}


const RETAILERS=[
  {id:'bestbuy',name:'Best Buy',theme:'#003087',accent:'#FFE000',base_url:process.env.BESTBUY_URL||'https://bestbuy-qna-dataextraction.netlify.app'},
  {id:'walmart',name:'Walmart', theme:'#0071CE',accent:'#FFC220',base_url:process.env.WALMART_URL||'https://walm-art-qna-dataextraction.netlify.app'},
  {id:'amazon', name:'Amazon',  theme:'#131921',accent:'#FF9900',base_url:process.env.AMAZON_URL ||'https://amazon-qna-dataextraction.netlify.app'},
  {id:'costco', name:'Costco',  theme:'#005DAA',accent:'#E31837',base_url:process.env.COSTCO_URL ||'https://costco-qna-dataextraction.netlify.app'}
];

const BASE_PRODUCTS=[
  {category:'tv',           sku_suffix:'TV-001', title:'Hisense 55\" U6 Series MiniLED QLED 4K HDR Smart Fire TV (2025)',  base_price:399.99,rating:4.7,review_count:1247,image:'https://placehold.co/500x420/1a1a2e/white?text=Hisense+55%22+U6+TV',     description:'Mini-LED QLED with Dolby Vision IQ, 120Hz, Game Mode Pro 144Hz, 4K UHD.',         specs:{'Screen Size':'55\"','Resolution':'4K UHD 2160p','Refresh Rate':'120Hz (144Hz VRR)','HDR':'Dolby Vision IQ, HDR10+','Platform':'Fire TV','HDMI Ports':'4 (2xHDMI 2.1)','Backlight':'Mini-LED','Wi-Fi':'Wi-Fi 6, Bluetooth 5.0'}},
  {category:'tv',           sku_suffix:'TV-002', title:'Hisense 65\" U8 Series MiniLED QLED 4K Smart Google TV (2025)',    base_price:699.99,rating:4.8,review_count:892, image:'https://placehold.co/500x420/0d1b2a/white?text=Hisense+65%22+U8+TV',     description:'1500-nit Mini-LED Pro, 144Hz, Quantum Dot Color, Hands-Free Voice Control.',       specs:{'Screen Size':'65\"','Resolution':'4K UHD 2160p','Refresh Rate':'144Hz VRR','Peak Brightness':'1500 nits','HDR':'Dolby Vision','Platform':'Google TV','HDMI Ports':'4 (2xHDMI 2.1)','Backlight':'Mini-LED Pro'}},
  {category:'refrigerator', sku_suffix:'REF-003',title:'Hisense 26 cu ft French Door Bottom Freezer Refrigerator',         base_price:1299.99,rating:4.5,review_count:434,image:'https://placehold.co/500x420/2c3e50/white?text=Hisense+French+Door+Fridge',description:'Counter-depth French door with ice maker, multi-airflow, and stainless finish.',  specs:{'Capacity':'26 cu ft','Type':'French Door','Ice Maker':'Yes','Water Dispenser':'Internal','Energy Star':'Yes','Noise':'38 dB','Finish':'Fingerprint Resistant SS'}}
];

const QB={
  tv:[
    {q:'Does this TV support Dolby Vision?',a:'Yes — Dolby Vision IQ and HDR10+ are both supported for premium HDR from Netflix, Disney+ and Apple TV+.'},
    {q:'What is the native refresh rate?',a:'The native panel is 120Hz. Game Mode Pro supports up to 144Hz via HDMI 2.1 with VRR enabled.'},
    {q:'Does it support HDMI 2.1?',a:'Yes! Ports 3 and 4 are full-bandwidth HDMI 2.1, supporting 4K@120Hz, VRR, ALLM and eARC.'},
    {q:'Can I use this with a PlayStation 5?',a:'Absolutely. HDMI 2.1 ports support PS5 at 4K 120fps with VRR for smooth, tear-free gameplay.'},
    {q:'What streaming apps are pre-installed?',a:'Netflix, Prime Video, Disney+, Apple TV+, Hulu and YouTube come pre-installed out of the box.'},
    {q:'Does it support Bluetooth headphones?',a:'Yes, Bluetooth 5.0 is built in for pairing wireless headphones, soundbars and audio devices.'},
    {q:'Is a wall mount included?',a:'No wall mount is included. The TV uses VESA 200x200mm — compatible mounts are sold separately.'},
    {q:'What is the peak brightness?',a:'This TV achieves up to 1000 nits peak brightness with Mini-LED local dimming fully activated.'},
    {q:'Does it have a sleep timer?',a:'Yes, sleep timer is in Settings with increments from 5 minutes up to 240 minutes.'},
    {q:'Can I connect a soundbar?',a:'Yes — via HDMI ARC/eARC on port 3, optical audio out, or Bluetooth for wireless connection.'}
  ],
  refrigerator:[
    {q:'How noisy is this refrigerator?',a:'It operates at just 38 dB — quieter than a whisper, ideal for open-plan kitchens.'},
    {q:'Does it have an ice maker?',a:'Yes — includes a built-in automatic ice maker producing up to 8 lbs of ice per day.'},
    {q:'Does the water dispenser require plumbing?',a:'Yes, a water line connection is required. An installation kit with fittings is included.'},
    {q:'What temperature range is supported?',a:'Refrigerator: 33-45F. Freezer: -4 to 8F. Both independently adjustable via the panel.'},
    {q:'Does it have a door alarm?',a:'Yes — an alarm sounds if a door is left open for more than 2 minutes.'}
  ],
  air_cooler:[
    {q:'What room size can this cool effectively?',a:'Rated for rooms up to 350 square feet — ideal for a large bedroom or small living room.'},
    {q:'How loud is it on the maximum setting?',a:'Maximum speed reaches 53 dB. On Sleep mode it reduces to 42 dB.'},
    {q:'Does it need to be vented outside?',a:'Yes — the exhaust hose must be vented through a window using the included kit.'}
  ],
  washing_machine:[
    {q:'Does it have a steam wash cycle?',a:'Yes — Steam Wash reaches 248F to eliminate 99.9% of bacteria and allergens.'},
    {q:'What is the maximum spin speed?',a:'1400 RPM — reduces residual moisture and cuts dryer time by up to 25%.'}
  ],
  gas_range:[
    {q:'Does it require professional installation?',a:'Yes — gas connections must be made by a licensed technician.'},
    {q:'What is the BTU of the power burner?',a:'The power burner outputs 18,000 BTU for rapid boiling.'},
    {q:'Does it have a convection oven?',a:'Yes! True Convection with a dedicated heating element for even baking.'}
  ],
  microwave:[
    {q:'What wattage is this microwave?',a:'1000 watts via Inverter Technology for consistent, even heating.'},
    {q:'Does it have sensor cooking?',a:'Yes! Sensor cooking automatically adjusts time and power for perfect results.'}
  ],
  home_appliance:[
    {q:'What temperature range does it maintain?',a:'Upper zone: 54-64F for reds. Lower zone: 41-54F for whites. Both independently set.'},
    {q:'How many bottles does it hold?',a:'Up to 50 standard 750ml bottles across 14 chrome wire shelves.'}
  ]
};

const KB_SEED=[
  {title:'Hisense Warranty Policy',kb_category:'warranty',product_category:null,content:'All Hisense products come with a 1-year limited warranty covering manufacturing defects. TVs include an additional 1-year labor warranty. Extended warranties available at purchase. Register at hisense-usa.com/warranty within 30 days.',tags:['warranty','repair','defect']},
  {title:'Hisense Return Policy',kb_category:'returns',product_category:null,content:'Returns accepted within 30 days of purchase with original receipt. Items must be in original packaging and undamaged. Contact your retailer (BestBuy, Walmart, Amazon, Costco) directly for their specific return procedures.',tags:['return','refund','exchange']},
  {title:'Hisense Customer Support',kb_category:'policy',product_category:null,content:'Customer support available at 1-888-935-8880 Mon-Fri 9am-9pm EST. Online chat at hisense-usa.com. Email support@hisense-usa.com. Average response time 24 hours.',tags:['support','contact','help']},
  {title:'Hisense TV HDMI 2.1 Compatibility',kb_category:'compatibility',product_category:'tv',content:'Hisense U6 and U8 Series TVs include 2x HDMI 2.1 ports supporting 4K@120Hz, Variable Refresh Rate (VRR), Auto Low Latency Mode (ALLM), and eARC. Compatible with PS5, Xbox Series X at full 4K 120fps.',tags:['hdmi','ps5','xbox','gaming','4k']},
  {title:'Hisense TV HDR Support',kb_category:'product_info',product_category:'tv',content:'U6 Series: Dolby Vision IQ, HDR10+, HDR10, HLG. U8 Series: Dolby Vision IQ, HDR10+ Adaptive, Dolby Atmos. Dolby Atmos audio passthrough via HDMI ARC/eARC.',tags:['hdr','dolby','vision','atmos','hdr10']},
  {title:'Hisense TV Refresh Rate',kb_category:'product_info',product_category:'tv',content:'Native panel refresh rates: U6 Series 120Hz, U8 Series 144Hz. Game Mode Pro enables up to 144Hz on U8 via HDMI 2.1 with VRR enabled.',tags:['refresh','rate','120hz','144hz','motion']},
  {title:'Hisense TV Smart Platform',kb_category:'product_info',product_category:'tv',content:'Fire TV (BestBuy U6): Amazon Alexa built-in, 500k+ titles. Google TV (Walmart): Google Assistant, Chromecast built-in. Android TV (Amazon): Google Play Store, 7,000+ apps.',tags:['smart','fire','google','android','alexa','apps']},
  {title:'Hisense TV Wall Mount Specs',kb_category:'usage',product_category:'tv',content:'55" models: VESA 200x200mm. 65" models: VESA 300x200mm. 75" models: VESA 400x300mm. Use M6 screws, max depth 20mm. Wall mount not included.',tags:['wall mount','vesa','install','bracket']},
  {title:'Hisense TV Connectivity',kb_category:'compatibility',product_category:'tv',content:'All models include: 4x HDMI (2x HDMI 2.1), 2x USB 3.0, optical audio output, headphone jack, Wi-Fi 6, Bluetooth 5.0, Ethernet LAN port.',tags:['wifi','bluetooth','usb','ethernet','hdmi','ports']},
  {title:'Hisense TV Pricing',kb_category:'pricing',product_category:'tv',content:'55" U6 Series: $399.99 MSRP. 65" U8 Series: $699.99 MSRP. 75" QD7 Series: $999.99 MSRP. Prices vary by retailer. BestBuy, Walmart, Amazon, Costco offer seasonal discounts.',tags:['price','cost','msrp','discount']},
  {title:'Hisense Refrigerator Temperature Settings',kb_category:'usage',product_category:'refrigerator',content:'Recommended: Refrigerator 37F (3C). Freezer 0F (-18C). Allow 24 hours after initial setup for temperature to stabilize. Adjust using the electronic control panel.',tags:['temperature','settings','cooling','freezer']},
  {title:'Hisense Refrigerator Ice Maker',kb_category:'product_info',product_category:'refrigerator',content:'Built-in ice maker produces 8 lbs per day. First ice batch ready 24 hours after water line connection. Discard first 3 batches. Water filter replacement every 6 months.',tags:['ice','ice maker','water','filter']},
  {title:'Hisense Washer Cycles',kb_category:'usage',product_category:'washing_machine',content:'14 wash cycles: Cotton, Synthetics, Delicates, Wool, Sports, Quick 15-min, Drum Clean, Steam Refresh, Baby Care, Allergen, Dark, Rinse & Spin, Spin Only, Hand Wash.',tags:['cycles','wash','steam','cotton','settings']},
  {title:'Hisense AC Installation',kb_category:'usage',product_category:'air_cooler',content:'Portable AC requires window venting kit (included). Exhaust hose max length 5 feet. Compatible with single or double-hung windows 18-50 inches wide.',tags:['install','window','vent','hose','portable']},
  {title:'Hisense Wine Cooler Temperature Zones',kb_category:'usage',product_category:'home_appliance',content:'Upper zone (red wines): 54-64F. Lower zone (white/sparkling): 41-54F. Both zones independently controlled via digital touch panel. Initial cooldown takes approximately 4 hours.',tags:['temperature','wine','zones','red','white']},
  {title:'Where to find Model and Serial Number',kb_category:'faq',product_category:null,content:'Model and serial numbers are located on a label: TVs — back panel lower left. Refrigerators — inside door jamb. Washers — inside drum door opening. ACs — back panel. Also visible in Settings > About on smart TVs.',tags:['model','serial','number','label','find']},
  {title:'Hisense App Setup',kb_category:'usage',product_category:null,content:'Download the Hisense App (iOS/Android) or VIDAA Remote app. For smart appliances: Settings > Wi-Fi > connect to 2.4GHz network > open app > Add Device > follow on-screen steps. Requires iOS 12+ or Android 8+.',tags:['app','wifi','setup','remote','smart']}
];

let MEM_PRODUCTS=[], MEM_QUESTIONS=[];

function rand(min,max){return Math.floor(Math.random()*(max-min+1))+min;}

const USERNAMES=['TechLover99','HomeImprover','BudgetBuyer','John_T','Sarah_M','GadgetGuru','SmartShopper','CoolDad2024','KitchenChef','MovieNight'];

function makeQRow(product,qa){
  const daysAgo=rand(3,75);
  const askedAt=new Date(); askedAt.setDate(askedAt.getDate()-daysAgo); askedAt.setHours(rand(8,22),rand(0,59));
  return {
    product_id:product.id, retailer_id:product.retailer_id,
    question_text:qa.q, asked_by:USERNAMES[rand(0,USERNAMES.length-1)],
    asked_at:askedAt.toISOString(), status:'unanswered', ai_generated:false,
    language:'en', language_name:'English', category:'product_info',
    sentiment:['positive','neutral','neutral','negative'][rand(0,3)],
    ai_confidence:0
  };
}

async function callClaude(prompt,systemPrompt,maxTokens){
  if(!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  // Use model from env var for flexibility, default to claude-haiku-4-5
  const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
  const resp=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({model,max_tokens:maxTokens||500,
      system:systemPrompt,messages:[{role:'user',content:prompt}]})
  });
  if(!resp.ok){const e=await resp.text();throw new Error('Claude '+resp.status+': '+e);}
  const d=await resp.json();
  return d.content[0].text;
}

async function enrichQuestion(questionText,productTitle,productCategory){
  const sys=`You are a customer question analyzer for Hisense electronics. Respond ONLY with a valid JSON object. No markdown fences, no explanation, no extra text. Required keys: language (ISO 639-1 code), language_name (full language name in English), category (one of: product_info pricing warranty compatibility usage complaint returns other), sentiment (positive neutral or negative), needs_review (true or false), review_reason (string explaining why, or null)`;
  const prompt=`Product: ${productTitle} (${productCategory})\nCustomer question: "${questionText}"\nDetect language and analyze. Respond with JSON only.`;
  try{
    const raw=await callClaude(prompt,sys,250);
    // Strip any markdown fences, leading/trailing whitespace
    const cleaned=raw.replace(/```json?/g,'').replace(/```/g,'').trim();
    // Extract JSON object (handles cases where Claude adds text around it)
    const match = cleaned.match(/\{[\s\S]*\}/);
    if(!match) throw new Error('No JSON object in response');
    const r=JSON.parse(match[0]);
    const cats=['product_info','pricing','warranty','compatibility','usage','complaint','returns','other'];
    const sents=['positive','neutral','negative'];
    const lang = (r.language||'en').toLowerCase().replace(/[^a-z]/g,'').substring(0,5);
    const isNonEn = lang && lang!=='en';
    return{
      language:lang, language_name:r.language_name||'English',
      category:cats.includes(r.category)?r.category:'product_info',
      sentiment:sents.includes(r.sentiment)?r.sentiment:'neutral',
      needs_review:isNonEn||r.needs_review===true,
      review_reason:r.review_reason||(isNonEn?`Non-English question (${r.language_name||lang}) — requires human review`:null)
    };
  }catch(e){
    console.error('[Enrichment Error]',e.message);
    // Return safe defaults — question will be processable even if AI enrichment fails
    return{language:'en',language_name:'English',category:'product_info',sentiment:'neutral',needs_review:false,review_reason:null,_enrichError:e.message};
  }
}

async function searchKB(questionText,category,productCategory){
  const terms=questionText.toLowerCase().split(/\s+/).filter(w=>w.length>3).slice(0,8);
  if(!DB_READY) return KB_SEED.filter(e=>{
    const t=(e.title+' '+e.content).toLowerCase();
    return terms.some(w=>t.includes(w));
  }).slice(0,5);
  const{data}=await db.from('knowledge_base').select('*').eq('is_active',true)
    .or(`kb_category.eq.${category},product_category.eq.${productCategory},product_category.is.null`).limit(20);
  if(!Array.isArray(data)||!data.length) return[];
  return data.map(e=>({
    ...e,
    score:terms.filter(t=>((e.title||'')+' '+(e.content||'')).toLowerCase().includes(t)).length
  }))
    .filter(e=>e.score>0).sort((a,b)=>b.score-a.score).slice(0,5);
}

async function generateRagAnswer(question,product,kbEntries){
  const sys=`You are a Hisense customer support expert. Answer using ONLY the knowledge base provided. Respond ONLY with valid JSON — no markdown. Keys: answer (string), confidence (0-1 number), needs_review (boolean), review_reason (string or null)`;
  const ctx=kbEntries.length?kbEntries.map((e,i)=>`[KB${i+1}] ${e.title}: ${e.content}`).join('\n'):'No relevant KB entries found.';
  const prompt=`Product: ${product.title}\nSpecs: ${JSON.stringify(product.specs||{})}\n\nKnowledge Base:\n${ctx}\n\nQuestion: "${question}"\n\nGenerate a helpful answer. If KB is insufficient, set confidence < 0.5 and needs_review true.`;
  try{
    const raw=await callClaude(prompt,sys,400);
    const cleaned=raw.replace(/```json?|```/g,'').trim();
    const match=cleaned.match(/\{[\s\S]*\}/);
    if(!match) throw new Error('No JSON object in Claude response');
    const r=JSON.parse(match[0]);
    if(!r.answer||typeof r.answer!=='string') throw new Error('Claude response missing answer field');
    const conf=Math.min(1,Math.max(0,parseFloat(r.confidence)||0.5));
    return{answer:r.answer||'',confidence:Math.round(conf*100)/100,confidence_pct:Math.round(conf*100),
      needs_review:conf<AI_THRESHOLD||!!r.needs_review,
      review_reason:r.review_reason||(conf<AI_THRESHOLD?`Low confidence (${Math.round(conf*100)}%)`:null)};
  }catch(e){
    console.error('[RAG Error]',e.message);
    return{answer:'Unable to generate answer — please review manually.',confidence:0,confidence_pct:0,needs_review:true,review_reason:'AI generation error: '+e.message};
  }
}

async function dbGetProducts(filters){
  if(!DB_READY){
    let l=[...MEM_PRODUCTS];
    if(filters&&filters.retailer_id) l=l.filter(p=>p.retailer_id===filters.retailer_id);
    if(filters&&filters.category) l=l.filter(p=>p.category===filters.category);
    return l;
  }
  let q=db.from('products').select('*');
  if(filters&&filters.retailer_id) q=q.eq('retailer_id',filters.retailer_id);
  if(filters&&filters.category) q=q.eq('category',filters.category);
  const{data,error}=await q.order('retailer_id').order('category');
  if(error) throw error;
  return data||[];
}

async function dbGetProduct(id){
  if(!DB_READY) return MEM_PRODUCTS.find(p=>p.id===id||p.sku===id)||null;
  // Try UUID lookup first, then SKU — avoids Supabase UUID cast error with .or()
  const{data:byId}=await db.from('products').select('*').eq('id',id).maybeSingle();
  if(byId) return byId;
  const{data:bySku}=await db.from('products').select('*').eq('sku',id).maybeSingle();
  return bySku||null;
}

async function dbGetQuestions(filters,page,limit){
  page=page||1; limit=limit||10;
  if(!DB_READY){
    let qs=[...MEM_QUESTIONS];
    if(filters.product_id)  qs=qs.filter(q=>q.product_id===filters.product_id);
    if(filters.retailer_id) qs=qs.filter(q=>q.retailer_id===filters.retailer_id);
    if(filters.status)      qs=qs.filter(q=>q.status===filters.status);
    if(filters.category)    qs=qs.filter(q=>q.category===filters.category);
    if(filters.search)      qs=qs.filter(q=>q.question_text.toLowerCase().includes(filters.search.toLowerCase()));
    qs.sort((a,b)=>new Date(b.asked_at)-new Date(a.asked_at));
    return{data:qs.slice((page-1)*limit,page*limit),total:qs.length};
  }
  let q=db.from('questions').select('*,answers(*),products(title,product_url)',{count:'exact'});
  if(filters.product_id)  q=q.eq('product_id',filters.product_id);
  if(filters.retailer_id) q=q.eq('retailer_id',filters.retailer_id);
  if(filters.status)      q=q.eq('status',filters.status);
  if(filters.category)    q=q.eq('category',filters.category);
  if(filters.search)      q=q.ilike('question_text','%'+filters.search+'%');
  const from=(page-1)*limit;
  const to=page*limit-1;
  const{data,count,error}=await q.order('asked_at',{ascending:false}).range(from,to);
  // Supabase throws "Requested range not satisfiable" when page is beyond data size — return empty
  if(error){
    if(error.message&&error.message.includes('range not satisfiable')) return{data:[],total:0};
    throw error;
  }
  const flat=(Array.isArray(data)?data:[]).map(row=>{
    // Supabase returns unique FK joins as single object, not array
    const rawAns=row.answers;
    const ans=Array.isArray(rawAns)?rawAns[0]||(rawAns.length?rawAns[0]:null):(rawAns&&rawAns.id?rawAns:null);
    const{answers,...rest}=row;
    const pTitle=row.products?.title||null;
    const pUrl=row.products?.product_url||null;
    return{...rest,answer:ans,product_title:pTitle,product_url:pUrl};
  });
  return{data:flat,total:count||0};
}

async function dbInsert(table,obj){
  if(table==='questions'){if(!DB_READY){obj.id=obj.id||uuidv4();MEM_QUESTIONS.push(obj);return obj;}const{data,error}=await db.from('questions').insert(obj).select().single();if(error)throw error;return data;}
  if(table==='answers'){
    if(!DB_READY){const q=MEM_QUESTIONS.find(x=>x.id===obj.question_id);if(q){q.answer=obj;q.status=obj.is_approved?'answered':'review';}return obj;}
    const{data,error}=await db.from('answers').upsert(obj,{onConflict:'question_id'}).select().single();
    if(error)throw error;
    await db.from('questions').update({status:obj.is_approved?'answered':'review'}).eq('id',obj.question_id);
    return data;
  }
  throw new Error('Unknown table: '+table);
}

async function dbUpdateQuestion(id,updates){
  if(!DB_READY){const q=MEM_QUESTIONS.find(x=>x.id===id);if(q)Object.assign(q,updates);return q;}
  const{data,error}=await db.from('questions').update(updates).eq('id',id).select().single();
  if(error)throw error;
  return data;
}

async function seedDatabase(){
  if(!DB_READY){
    RETAILERS.forEach(r=>{
      const priceOff={bestbuy:1.00,walmart:0.95,amazon:0.98,costco:0.92}[r.id];
      BASE_PRODUCTS.forEach((bp,i)=>{
        const sku=`${r.id.toUpperCase().slice(0,2)}-${bp.sku_suffix}`;
        const pid=uuidv4();
        MEM_PRODUCTS.push({id:pid,retailer_id:r.id,retailer_name:r.name,sku,category:bp.category,title:bp.title,
          description:bp.description,base_price:bp.base_price,price:Math.round(bp.base_price*priceOff*100)/100,
          rating:bp.rating,review_count:bp.review_count,image:bp.image,specs:bp.specs,
          product_url:`${r.base_url}/?product=${pid}`,created_at:new Date().toISOString()});
      });
    });
    MEM_PRODUCTS.forEach(p=>{
      const bank=QB[p.category]||QB.tv;
      [...bank].sort(()=>Math.random()-0.5).slice(0,2).forEach(qa=>{
        const row=makeQRow(p,qa); row.id=uuidv4(); row.answer=null; MEM_QUESTIONS.push(row);
      });
    });
    console.log('In-memory: '+MEM_PRODUCTS.length+' products, '+MEM_QUESTIONS.length+' questions');
    return;
  }
  const{count}=await db.from('products').select('*',{count:'exact',head:true});
  if(count>0){console.log('Supabase: '+count+' products already exist — skipping seed');return;}
  console.log('Seeding Supabase...');
  const allProducts=[];
  RETAILERS.forEach(r=>{
    const priceOff={bestbuy:1.00,walmart:0.95,amazon:0.98,costco:0.92}[r.id];
    BASE_PRODUCTS.forEach((bp,i)=>{
      const sku=`${r.id.toUpperCase().slice(0,2)}-${bp.sku_suffix}`;
      allProducts.push({retailer_id:r.id,retailer_name:r.name,sku,category:bp.category,title:bp.title,
        description:bp.description,base_price:bp.base_price,price:Math.round(bp.base_price*priceOff*100)/100,
        rating:bp.rating,review_count:bp.review_count,image:bp.image,specs:bp.specs,
        product_url:`${r.base_url}/?product=PLACEHOLDER`});
    });
  });
  const{data:prods,error:pErr}=await db.from('products').insert(allProducts).select();
  if(pErr){console.error('Product seed error:',pErr.message);return;}
  // Update product_url with real UUIDs now we have them + find retailer base_url
  for(const p of prods){
    const r=RETAILERS.find(x=>x.id===p.retailer_id);
    if(r) await db.from('products').update({product_url:`${r.base_url}/?product=${p.id}`}).eq('id',p.id);
  }
  console.log('  '+prods.length+' products seeded');
  const allQs=[];
  prods.forEach(p=>{
    const bank=QB[p.category]||QB.tv;
    [...bank].sort(()=>Math.random()-0.5).slice(0,2).forEach(qa=>allQs.push(makeQRow(p,qa)));
  });
  const{data:insertedQs,error:qErr}=await db.from('questions').insert(allQs).select();
  if(qErr){console.error('Question seed error:',qErr.message);return;}
  const toAnswer=insertedQs.filter(()=>Math.random()>0.4);
  const ansRows=toAnswer.map(q=>{
    const p=prods.find(x=>x&&x.id===q.product_id);
    const bank=QB[(p&&p.category)||'tv']||QB.tv||[];
    const qa=bank.find(x=>x&&x.q===q.question_text)||{a:'Thank you for your question! Our team will review and respond shortly.'};
    return{question_id:q.id,answer_text:qa.a,answered_by:'HisenseExpert',
      answered_at:new Date(new Date(q.asked_at).getTime()+rand(1,5)*86400000).toISOString(),is_approved:true};
  });
  if(ansRows.length){
    await db.from('questions').update({status:'answered'}).in('id',toAnswer.map(q=>q.id));
    await db.from('answers').insert(ansRows);
  }
  console.log('  '+insertedQs.length+' questions, '+ansRows.length+' answered');
  await db.from('knowledge_base').insert(KB_SEED.map(k=>({...k,source:'seed'})));
  console.log('  '+KB_SEED.length+' KB entries seeded');
  console.log('Seeding complete!');
}

// ─── ROUTES ───────────────────────────────────────────────────

app.get('/api/health',async(_req,res)=>{
  try{
    let p=MEM_PRODUCTS.length,q=MEM_QUESTIONS.length,a=MEM_QUESTIONS.filter(x=>x.status==='answered').length,rev=0,kb=0;
    if(DB_READY){
      const[pc,qc,ac,rc,kc]=await Promise.all([
        db.from('products').select('*',{count:'exact',head:true}),
        db.from('questions').select('*',{count:'exact',head:true}),
        db.from('questions').select('*',{count:'exact',head:true}).eq('status','answered'),
        db.from('questions').select('*',{count:'exact',head:true}).eq('status','review'),
        db.from('knowledge_base').select('*',{count:'exact',head:true}).eq('is_active',true)
      ]);
      p=pc.count||0;q=qc.count||0;a=ac.count||0;rev=rc.count||0;kb=kc.count||0;
    }
    const retailer_urls=Object.fromEntries(RETAILERS.map(r=>[r.id,r.base_url]));
    res.json({status:'ok',uptime:Math.round(process.uptime()),db_connected:DB_READY,
      ai_configured:!!ANTHROPIC_KEY,products:p,questions:q,answered:a,review:rev,kb_entries:kb,
      retailer_urls,timestamp:new Date().toISOString()});
  }catch(e){res.json({status:'ok',uptime:Math.round(process.uptime()),db_connected:false,error:e.message});}
});

app.get('/api',(_req,res)=>res.json({name:'Q&A Automation API v2.0',db_mode:DB_READY?'supabase':'in-memory',ai_enabled:!!ANTHROPIC_KEY,endpoints:['GET /api/health','GET /api/retailers','GET /api/products?retailer=&category=','GET /api/products/:id','GET /api/products/:id/questions?status=&page=1&limit=10','POST /api/questions/add','POST /api/questions/generate','POST /api/questions/:id/answer','POST /api/questions/:id/ai-answer','PATCH /api/questions/:id/approve','GET /api/knowledge-base?category=&product_category=&search=','POST /api/knowledge-base','PUT /api/knowledge-base/:id','DELETE /api/knowledge-base/:id','GET /api/admin/stats','GET /api/admin/questions?retailer=&status=&category=&search=','GET /api/export/qa','GET /api/logs']}));

app.get('/api/retailers',(_req,res)=>res.json({success:true,data:RETAILERS}));

app.get('/api/products',async(req,res)=>{
  try{
    const filters={};
    if(req.query.retailer) filters.retailer_id=req.query.retailer;
    if(req.query.category) filters.category=req.query.category;
    const products=await dbGetProducts(filters);
    res.json({success:true,count:products.length,data:products});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/products/:id',async(req,res)=>{
  try{
    const p=await dbGetProduct(req.params.id);
    if(!p) return res.status(404).json({success:false,error:'Product not found'});
    res.json({success:true,data:p});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/products/:id/questions',async(req,res)=>{
  try{
    const p=await dbGetProduct(req.params.id);
    if(!p) return res.status(404).json({success:false,error:'Product not found'});
    const page=parseInt(req.query.page)||1, limit=parseInt(req.query.limit)||10;
    const filters={product_id:p.id};
    if(req.query.status) filters.status=req.query.status;
    const{data,total}=await dbGetQuestions(filters,page,limit);
    res.json({success:true,total,page,limit,pages:Math.ceil(total/limit),data});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.post('/api/questions/add',async(req,res)=>{
  try{
    const{product_id,question_text,asked_by}=req.body||{};
    if(!product_id||!question_text) return res.status(400).json({success:false,error:'product_id and question_text required'});
    const product=await dbGetProduct(product_id);
    if(!product) return res.status(404).json({success:false,error:'Product not found'});
    const qData={product_id:product.id,retailer_id:product.retailer_id,question_text,
      asked_by:asked_by||'Anonymous',asked_at:new Date().toISOString(),status:'unanswered',
      ai_generated:false,language:'en',language_name:'English',category:'product_info',sentiment:'neutral',ai_confidence:0};
    if(!DB_READY) qData.id=uuidv4();
    if(ANTHROPIC_KEY){
      try{const e=await enrichQuestion(question_text,product.title,product.category);
        Object.assign(qData,{language:e.language,language_name:e.language_name,category:e.category,sentiment:e.sentiment});
        if(e.needs_review){qData.status='review';qData.review_reason=e.review_reason;}
      }catch(err){ console.error('[Enrich skip]',err.message); }
    }
    const saved=await dbInsert('questions',qData);
    res.json({success:true,data:saved});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.post('/api/questions/generate',async(req,res)=>{
  try{
    const{product_id,count=3}=req.body||{};
    const product=await dbGetProduct(product_id);
    if(!product) return res.status(404).json({success:false,error:'Product not found'});
    const bank=QB[product.category]||QB.tv;
    const _cnt=parseInt(count); const _n=isNaN(_cnt)||_cnt<0?3:_cnt;
    const toAdd=[...bank].sort(()=>Math.random()-0.5).slice(0,Math.min(_n,bank.length));
    const inserted=[];
    for(const qa of toAdd){
      const row=makeQRow(product,qa); row.ai_generated=true;
      if(!DB_READY) row.id=uuidv4();
      inserted.push(await dbInsert('questions',row));
    }
    res.json({success:true,generated:inserted.length,data:inserted});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.post('/api/questions/:id/answer',async(req,res)=>{
  try{
    const{answer_text,answered_by,is_approved}=req.body||{};
    if(!answer_text) return res.status(400).json({success:false,error:'answer_text required'});
    // Verify question exists
    let questionExists=false;
    if(DB_READY){
      const{data}=await db.from('questions').select('id').eq('id',req.params.id).maybeSingle();
      questionExists=!!data;
    } else {
      questionExists=!!MEM_QUESTIONS.find(x=>x.id===req.params.id);
    }
    if(!questionExists) return res.status(404).json({success:false,error:'Question not found'});
    const aData={question_id:req.params.id,answer_text,answered_by:answered_by||'HisenseExpert',
      answered_at:new Date().toISOString(),is_approved:is_approved!==false,kb_sources:[]};
    if(!DB_READY) aData.id=uuidv4();
    const saved=await dbInsert('answers',aData);
    res.json({success:true,data:saved});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.post('/api/questions/:id/ai-answer',async(req,res)=>{
  try{
    if(!ANTHROPIC_KEY) return res.status(400).json({success:false,error:'ANTHROPIC_API_KEY not configured'});
    let question;
    if(DB_READY){const{data}=await db.from('questions').select('*').eq('id',req.params.id).single();question=data;}
    else{question=MEM_QUESTIONS.find(q=>q.id===req.params.id);}
    if(!question) return res.status(404).json({success:false,error:'Question not found'});
    const product=await dbGetProduct(question.product_id);
    if(!product) return res.status(404).json({success:false,error:'Product not found'});
    const kbEntries=await searchKB(question.question_text,question.category||'product_info',product.category);
    const result=await generateRagAnswer(question.question_text,product,kbEntries);
    if(!result.needs_review&&result.confidence>=AI_THRESHOLD){
      const aData={question_id:question.id,answer_text:result.answer,answered_by:'AI (RAG)',
        answered_at:new Date().toISOString(),is_approved:true,kb_sources:kbEntries.map(e=>e.id||e.title)};
      if(!DB_READY) aData.id=uuidv4();
      await dbInsert('answers',aData);
      await dbUpdateQuestion(question.id,{ai_confidence:result.confidence,status:'answered'});
    }else{
      await dbUpdateQuestion(question.id,{status:'review',review_reason:result.review_reason,ai_confidence:result.confidence});
    }
    res.json({success:true,data:{...result,kb_entries_used:kbEntries.length}});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.patch('/api/questions/:id/approve',async(req,res)=>{
  try{
    const{approved_by,add_to_kb}=req.body||{};
    if(!DB_READY){
      const q=MEM_QUESTIONS.find(x=>x.id===req.params.id);
      if(!q) return res.status(404).json({success:false,error:'Question not found'});
      if(q&&q.answer){q.answer.is_approved=true;q.status='answered';}
      return res.json({success:true,added_to_kb:false});
    }
    // Verify question exists first
    const{data:existCheck}=await db.from('questions').select('id').eq('id',req.params.id).maybeSingle();
    if(!existCheck) return res.status(404).json({success:false,error:'Question not found'});
    // Update answer approval
    await db.from('answers').update({
      is_approved:true,
      approved_by:approved_by||'Operator',
      approved_at:new Date().toISOString()
    }).eq('question_id',req.params.id);
    // Update question status
    await db.from('questions').update({status:'answered'}).eq('id',req.params.id);
    
    let added_to_kb = false;
    if(add_to_kb){
      // Fetch question and answer separately (more reliable than join)
      const[{data:q},{data:ans}]=await Promise.all([
        db.from('questions').select('*').eq('id',req.params.id).maybeSingle(),
        db.from('answers').select('*').eq('question_id',req.params.id).maybeSingle()
      ]);
      if(q&&ans&&ans.answer_text){
        const{error}=await db.from('knowledge_base').insert({
          title:q.question_text.substring(0,80),
          content:ans.answer_text,
          kb_category:q.category||'faq',
          product_category:null,
          tags:['approved_answer'],
          source:'approved_answer',
          is_active:true
        });
        if(!error) added_to_kb=true;
        else console.error('[KB insert]', error.message);
      }
    }
    res.json({success:true,added_to_kb});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/knowledge-base',async(req,res)=>{
  try{
    if(!DB_READY) return res.json({success:true,data:KB_SEED.map((k,i)=>({...k,id:'kb-'+i,is_active:true,source:'seed',created_at:new Date().toISOString()}))});
    let q=db.from('knowledge_base').select('*').eq('is_active',true);
    if(req.query.category)         q=q.eq('kb_category',req.query.category);
    if(req.query.product_category) q=q.eq('product_category',req.query.product_category);
    if(req.query.search)           q=q.ilike('content','%'+req.query.search+'%');
    const{data,error}=await q.order('created_at',{ascending:false});
    if(error) throw error;
    res.json({success:true,count:(data||[]).length,data:data||[]});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.post('/api/knowledge-base',async(req,res)=>{
  try{
    if(!DB_READY) return res.status(503).json({success:false,error:'DB not connected — use Supabase'});
    const{title,content,kb_category,product_category,tags,source}=req.body||{};
    if(!title||!content) return res.status(400).json({success:false,error:'title and content required'});
    const{data,error}=await db.from('knowledge_base').insert({title,content,kb_category:kb_category||'faq',
      product_category:product_category||null,tags:tags||[],source:source||'manual',is_active:true}).select().single();
    if(error) throw error;
    res.json({success:true,data});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.put('/api/knowledge-base/:id',async(req,res)=>{
  try{
    if(!DB_READY) return res.status(503).json({success:false,error:'DB not connected'});
    const updates={};
    ['title','content','kb_category','product_category','tags','is_active'].forEach(k=>{if(req.body[k]!==undefined) updates[k]=req.body[k];});
    const{data,error}=await db.from('knowledge_base').update(updates).eq('id',req.params.id).select().single();
    if(error) throw error;
    res.json({success:true,data});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.delete('/api/knowledge-base/:id',async(req,res)=>{
  try{
    if(!DB_READY) return res.status(503).json({success:false,error:'DB not connected'});
    const{data:existing}=await db.from('knowledge_base').select('id').eq('id',req.params.id).maybeSingle();
    if(!existing) return res.status(404).json({success:false,error:'KB entry not found'});
    await db.from('knowledge_base').update({is_active:false}).eq('id',req.params.id);
    res.json({success:true,message:'Entry deactivated'});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/admin/stats',async(_req,res)=>{
  try{
    if(!DB_READY){
      const s={total_products:MEM_PRODUCTS.length,total_questions:MEM_QUESTIONS.length,
        answered:MEM_QUESTIONS.filter(q=>q.status==='answered').length,
        unanswered:MEM_QUESTIONS.filter(q=>q.status==='unanswered').length,
        review:MEM_QUESTIONS.filter(q=>q.status==='review').length,
        db_connected:false,ai_configured:!!ANTHROPIC_KEY,by_retailer:{},by_category:{},by_sentiment:{}};
      RETAILERS.forEach(r=>{const rqs=MEM_QUESTIONS.filter(q=>q.retailer_id===r.id);s.by_retailer[r.id]={name:r.name,questions:rqs.length,answered:rqs.filter(q=>q.status==='answered').length};});
      return res.json({success:true,data:s});
    }
    const[pc,qAll,qAns,qUnans,qRev,kbc]=await Promise.all([
      db.from('products').select('*',{count:'exact',head:true}),
      db.from('questions').select('*',{count:'exact',head:true}),
      db.from('questions').select('*',{count:'exact',head:true}).eq('status','answered'),
      db.from('questions').select('*',{count:'exact',head:true}).eq('status','unanswered'),
      db.from('questions').select('*',{count:'exact',head:true}).eq('status','review'),
      db.from('knowledge_base').select('*',{count:'exact',head:true}).eq('is_active',true)
    ]);
    const{data:catRows}=await db.from('questions').select('category');
    const by_category={};(catRows||[]).forEach(r=>{by_category[r.category]=(by_category[r.category]||0)+1;});
    const{data:sentRows}=await db.from('questions').select('sentiment');
    const by_sentiment={};(sentRows||[]).forEach(r=>{by_sentiment[r.sentiment]=(by_sentiment[r.sentiment]||0)+1;});
    const by_retailer={};
    for(const r of RETAILERS){
      const[{count:rq},{count:ra}]=await Promise.all([
        db.from('questions').select('*',{count:'exact',head:true}).eq('retailer_id',r.id),
        db.from('questions').select('*',{count:'exact',head:true}).eq('retailer_id',r.id).eq('status','answered')
      ]);
      by_retailer[r.id]={name:r.name,questions:rq||0,answered:ra||0};
    }
    res.json({success:true,data:{total_products:pc.count||0,total_questions:qAll.count||0,
      answered:qAns.count||0,unanswered:qUnans.count||0,review:qRev.count||0,
      kb_entries:kbc.count||0,db_connected:true,ai_configured:!!ANTHROPIC_KEY,
      by_category,by_sentiment,by_retailer}});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/admin/questions',async(req,res)=>{
  try{
    const page=parseInt(req.query.page)||1,limit=parseInt(req.query.limit)||50;
    const filters={};
    if(req.query.retailer) filters.retailer_id=req.query.retailer;
    if(req.query.status)   filters.status=req.query.status;
    if(req.query.category) filters.category=req.query.category;
    if(req.query.search)   filters.search=req.query.search;
    const{data,total}=await dbGetQuestions(filters,page,limit);
    res.json({success:true,total,page,limit,data});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/export/qa',async(req,res)=>{
  try{
    const{data}=await dbGetQuestions({},1,10000);
    const csv=['ID,Product ID,Retailer,Question,Asked By,Date,Status,Language,Category,Sentiment,Confidence,Review Reason,Answer,Answered By,Approved']
      .concat((data||[]).map(q=>[q.id,q.product_id,q.retailer_id,
        '"'+(q.question_text||'').replace(/"/g,"'")+'"',q.asked_by,q.asked_at,q.status,
        q.language,q.category,q.sentiment,q.ai_confidence,
        '"'+(q.review_reason||'').replace(/"/g,"'")+'"',
        '"'+(q.answer?.answer_text||'').replace(/"/g,"'")+'"',
        q.answer?.answered_by||'',q.answer?.is_approved||false].join(','))).join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename=qa_export.csv');
    res.send(csv);
  }catch(e){res.status(500).json({success:false,error:e.message});}
});


// ── SYNC PRODUCT URLS ─────────────────────────────────────────
// Call POST /api/admin/sync-urls any time retailer URLs change (env vars updated)
// Updates all product_url values in DB from current RETAILERS config — no reseed needed
app.post('/api/admin/sync-urls',async(req,res)=>{
  try{
    if(!DB_READY) return res.status(503).json({success:false,error:'DB not connected'});
    // Accept optional URL overrides in body — e.g. {bestbuy:'https://...', walmart:'https://...'}
    const overrides=req.body||{};
    // Apply overrides to RETAILERS in-memory for this request
    const urlMap={};
    RETAILERS.forEach(r=>{
      urlMap[r.id]=overrides[r.id]||overrides[r.id+'_url']||r.base_url;
    });
    const{data:products,error}=await db.from('products').select('id,retailer_id');
    if(error) throw error;
    let updated=0;
    for(const p of products||[]){
      const base=urlMap[p.retailer_id];
      if(!base) continue;
      await db.from('products').update({product_url:`${base}/?product=${p.id}`}).eq('id',p.id);
      updated++;
    }
    res.json({success:true,updated,applied_urls:urlMap});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

app.get('/api/logs',(req,res)=>{
  try{
    const limit=Math.min(parseInt(req.query.limit)||100,500);
    res.json({success:true,count:LOGS.length,data:LOGS.slice(0,limit)});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

setInterval(async()=>{
  try{
    const products=await dbGetProducts();
    if(!products||!products.length) return;
    const p=products[rand(0,products.length-1)];
    if(!p||!p.id) return;
    const bank=QB[p.category]||QB.tv;
    const qa=bank[rand(0,bank.length-1)];
    const row=makeQRow(p,qa);
    if(!DB_READY) row.id=uuidv4();
    await dbInsert('questions',row);
  }catch(e){console.error('[AutoGen]', e.message);}
},10*60*1000);

seedDatabase().then(()=>{
  app.listen(PORT,()=>{
    console.log('\nQ&A Automation API v2.0 on port '+PORT);
    console.log('DB: '+(DB_READY?'Supabase':'In-memory'));
    console.log('AI: '+(ANTHROPIC_KEY?'Claude enabled':'Not configured'));
    console.log('Docs: http://localhost:'+PORT+'/api\n');
  });
}).catch(err=>{console.error('Startup error:',err);process.exit(1);});
