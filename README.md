# CX AgentX — Mock Retailer Ecosystem
## Deployment Guide

---

## What You're Deploying

| Component | Where | URL |
|---|---|---|
| Backend API | Railway | `https://cx-agentx-mock-api.up.railway.app` |
| BestBuy Mock | Netlify | `https://mock-bestbuy.netlify.app` |
| Walmart Mock | Netlify | `https://mock-walmart.netlify.app` |
| Amazon Mock | Netlify | `https://mock-amazon.netlify.app` |
| Costco Mock | Netlify | `https://mock-costco.netlify.app` |

---

## STEP 1 — Deploy Backend to Railway

### 1a. Create Railway Account
1. Go to https://railway.app
2. Sign up with GitHub (recommended)

### 1b. Deploy from GitHub
1. Push the `backend/` folder to a new GitHub repo:
   ```
   git init
   git add .
   git commit -m "CX AgentX Mock API"
   git remote add origin https://github.com/YOUR_USERNAME/cx-agentx-api.git
   git push -u origin main
   ```
2. In Railway dashboard: **New Project → Deploy from GitHub repo**
3. Select your repo → Railway auto-detects Node.js

### 1c. OR Deploy via Railway CLI
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### 1d. Set Environment Variables in Railway
Go to your Railway project → Variables tab → Add:
```
PORT=3000
BESTBUY_URL=https://mock-bestbuy.netlify.app
WALMART_URL=https://mock-walmart.netlify.app
AMAZON_URL=https://mock-amazon.netlify.app
COSTCO_URL=https://mock-costco.netlify.app
```

### 1e. Get Your Railway URL
After deploy, Railway gives you a URL like:
`https://cx-agentx-mock-api.up.railway.app`

**Test it:** Visit `https://YOUR-RAILWAY-URL.up.railway.app/api/health`
You should see: `{"status":"ok","products":32,"questions":...}`

---

## STEP 2 — Deploy Mock Pages to Netlify

You have 4 HTML files to deploy as 4 separate Netlify sites.

### For each retailer page:

1. Go to https://app.netlify.com (logged in as bindumathi.gr@gmail.com)
2. Click **"Add new site → Deploy manually"**
3. Drag the retailer's `index.html` file onto the drop zone
4. After deploy, rename the site:

| File | Rename Site To |
|---|---|
| `bestbuy/index.html` | `mock-bestbuy` |
| `walmart/index.html` | `mock-walmart` |
| `amazon/index.html` | `mock-amazon` |
| `costco/index.html` | `mock-costco` |

**To rename:** Site settings → General → Site details → Change site name

---

## STEP 3 — Update API URL in Mock Pages

After Railway deployment, update the `API_BASE` in each mock page:

### Option A: Via Admin Panel (easiest)
1. Open any mock page
2. Press **Ctrl+Shift+A** to open Admin Panel
3. Scroll to "API Base URL" section
4. Replace `https://cx-agentx-mock-api.up.railway.app` with your actual Railway URL
5. The page will use the new URL immediately

### Option B: Edit the HTML file
In each HTML file, find this line near the bottom:
```javascript
let API_BASE = localStorage.getItem('cx_api_base') || 'https://cx-agentx-mock-api.up.railway.app';
```
Replace `https://cx-agentx-mock-api.up.railway.app` with your Railway URL, then redeploy.

---

## STEP 4 — Test Everything

### Test the API
```bash
# Health check
curl https://YOUR-RAILWAY-URL.up.railway.app/api/health

# Get all products
curl https://YOUR-RAILWAY-URL.up.railway.app/api/products

# Get BestBuy products only
curl https://YOUR-RAILWAY-URL.up.railway.app/api/products?retailer=bestbuy

# Get questions for a product (replace ID)
curl https://YOUR-RAILWAY-URL.up.railway.app/api/products/PRODUCT_ID/questions

# Generate questions
curl -X POST https://YOUR-RAILWAY-URL.up.railway.app/api/questions/generate \
  -H "Content-Type: application/json" \
  -d '{"product_id":"PRODUCT_ID","count":5}'
```

### Test Mock Pages
1. Open `https://mock-bestbuy.netlify.app`
2. Products should load from the Railway API
3. Click a product → Q&A section loads
4. Click "🔄 Refresh" → new questions appear
5. Press **Ctrl+Shift+A** → Admin panel opens

---

## API Reference

### Base URL
`https://YOUR-RAILWAY-URL.up.railway.app`

### Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Server health + stats |
| GET | `/api/retailers` | List all 4 retailers |
| GET | `/api/products` | All products (filter: `?retailer=bestbuy&category=tv`) |
| GET | `/api/products/:id` | Single product by ID or SKU |
| GET | `/api/products/:id/questions` | Q&A for a product (filter: `?status=unanswered&sort=newest&page=1&limit=10`) |
| POST | `/api/questions/generate` | Generate random questions `{product_id, count}` |
| POST | `/api/questions/add` | Add manual question `{product_id, question_text, asked_by}` |
| POST | `/api/questions/:id/answer` | Answer a question `{answer_text, answered_by}` |
| GET | `/api/admin/stats` | Dashboard statistics |
| GET | `/api/admin/questions` | All questions (filter: `?retailer=&status=&search=`) |
| POST | `/api/admin/generate-bulk` | Bulk generate `{retailer_id, count_per_product}` |
| GET | `/api/export/urls` | Download product URLs as Excel |
| GET | `/api/export/qa` | Download Q&A as CSV (filter: `?retailer=costco`) |
| GET | `/api/logs` | Request logs (last 1000) |

---

## Admin Panel

Access the Admin Panel on any mock page:
- **Keyboard:** Ctrl+Shift+A
- **URL param:** `https://mock-bestbuy.netlify.app?admin=true`

Admin panel features:
- Live stats (products, questions, answered/unanswered)
- Generate questions for current product
- Bulk generate questions for all products
- Download Product URLs as Excel
- Export Q&A as CSV
- API request log
- Update API Base URL

---

## Auto Question Generation

The backend automatically generates 4 new questions every 3 minutes across random products. This simulates live retailer activity for the demo.

Each mock page also has a 3-minute auto-refresh timer (visible in admin panel) that calls the generate endpoint and refreshes the Q&A list.

---

## Troubleshooting

**Products not loading?**
→ Check the API URL in the Admin panel
→ Verify Railway deployment is running: visit `/api/health`
→ Check browser console for CORS errors

**Railway app sleeping?**
→ Free tier stays awake. If using Starter, it may sleep after inactivity
→ Visit the health endpoint to wake it up

**Questions not generating?**
→ Check that you're on a product detail page (not the listing page)
→ Verify API URL is correct in admin panel

---

## File Structure

```
cx-mock-ecosystem/
├── backend/
│   ├── server.js          ← Deploy this to Railway
│   ├── package.json
│   └── .env.example
├── bestbuy/
│   └── index.html         ← Deploy to mock-bestbuy.netlify.app
├── walmart/
│   └── index.html         ← Deploy to mock-walmart.netlify.app
├── amazon/
│   └── index.html         ← Deploy to mock-amazon.netlify.app
└── costco/
    └── index.html         ← Deploy to mock-costco.netlify.app
```
