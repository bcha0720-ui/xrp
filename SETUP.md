# AI Insights Backend Setup Guide

## Quick Setup (3 Steps)

### Step 1: Install Anthropic SDK
```bash
npm install @anthropic-ai/sdk
```

### Step 2: Add API Key to Render
1. Go to your Render dashboard
2. Select your service (xrp-gtve)
3. Go to **Environment** tab
4. Add new environment variable:
   - **Key:** `ANTHROPIC_API_KEY`
   - **Value:** `sk-ant-api03-xxxxx...` (your API key)
5. Click **Save Changes**

### Step 3: Add the Endpoint to Your Server

**Option A: Add to existing server.js**

Copy the code from `ai-insights-backend.js` and add to your existing server file.

**Option B: Replace entire server**

Use `server-with-ai.js` as a reference (you'll need to merge with your existing ETF endpoints).

---

## Get Your Anthropic API Key

1. Go to: https://console.anthropic.com/
2. Sign up or log in
3. Go to **API Keys**
4. Click **Create Key**
5. Copy the key (starts with `sk-ant-api03-`)

---

## Cost Control Features Built-In

### 1. Caching (5 minutes)
- Same insights served for 5 minutes
- Reduces API calls by ~90%

### 2. Rate Limiting
- Max 10 requests per minute per IP
- Prevents abuse

### 3. Stale Cache Fallback
- If API fails, returns cached data
- Never shows error to user if cache exists

---

## Testing the Endpoint

Once deployed, test with:

```bash
curl -X POST https://xrp-gtve.onrender.com/api/ai-insights \
  -H "Content-Type: application/json" \
  -d '{
    "marketData": {
      "currentPrice": 2.15,
      "priceChange24h": 3.5,
      "priceChange7d": 12.2,
      "priceChange30d": 45.0,
      "volume24h": 2500000000,
      "ma7": 2.05,
      "ma30": 1.92,
      "ma90": 1.45,
      "etfHoldings": 769000000,
      "exchangeHoldings": 5200000000,
      "etfVolume": 125000000,
      "sentimentScore": 65
    }
  }'
```

---

## Health Check

```bash
curl https://xrp-gtve.onrender.com/api/ai-insights/health
```

Response:
```json
{
  "status": "ok",
  "hasApiKey": true,
  "cacheStatus": "has_cache",
  "cacheAge": 120
}
```

---

## Estimated Costs

| Usage Level | Requests/Day | Monthly Cost |
|-------------|--------------|--------------|
| Low | 100 | ~$1-2 |
| Medium | 500 | ~$5-10 |
| High | 2000 | ~$20-40 |

Using Claude 3.5 Haiku - the fastest and most cost-effective model.

---

## Frontend Integration

The frontend code is already in your `index.html`. Once the backend is deployed:

1. The AI Insights tab will automatically call `/api/ai-insights`
2. Click "Refresh Insights" to fetch new AI analysis
3. Data is cached for 5 minutes to reduce costs

---

## Troubleshooting

**"No API key" error:**
- Check Render environment variables
- Redeploy after adding the key

**Rate limited:**
- Wait 1 minute
- Or increase MAX_REQUESTS in server code

**Slow response:**
- First request after cache expires takes 3-5 seconds
- Subsequent requests use cache (instant)

---

## Files Included

1. `ai-insights-backend.js` - Code snippet to add to existing server
2. `server-with-ai.js` - Complete server example with AI endpoint
3. `SETUP.md` - This file

