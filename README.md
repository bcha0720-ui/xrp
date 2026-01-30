# LunarCrush XRP Proxy

A simple Flask API proxy for LunarCrush data, designed for the XRP ETF Tracker.

## Features
- ✅ CORS enabled for browser requests
- ✅ API key hidden from frontend
- ✅ 5-minute caching to reduce API calls
- ✅ All XRP social data endpoints
- ✅ Combined `/api/xrp/all` endpoint for single request

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `/` | Health check |
| `/api/xrp/topic` | XRP social topic metrics (sentiment, posts, interactions) |
| `/api/xrp/posts` | Top XRP social posts from X, Reddit, YouTube |
| `/api/xrp/timeseries` | Historical social data (7 days) |
| `/api/xrp/creators` | Top XRP content creators |
| `/api/xrp/news` | XRP news articles |
| `/api/xrp/coin` | XRP market data (price, market cap, etc.) |
| `/api/xrp/all` | **All data combined in one request** |
| `/api/whatsup` | AI-generated XRP summary |

## Deploy to Render

### Option 1: One-Click Deploy
1. Push this folder to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Render will auto-detect `render.yaml`
5. Add environment variable:
   - `LUNARCRUSH_API_KEY` = `your-api-key`
6. Deploy!

### Option 2: Manual Setup
1. Go to [render.com](https://render.com) → New → Web Service
2. Connect GitHub or use "Public Git repository"
3. Configure:
   - **Environment**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app`
4. Add environment variable:
   - `LUNARCRUSH_API_KEY` = `00kyv32gahqdkkkxcieql160hz89ml0c542vj4hkro6`
5. Deploy!

## Usage in Frontend

Replace the direct LunarCrush API calls with your Render URL:

```javascript
// Before (blocked by CORS)
const response = await fetch('https://lunarcrush.com/api4/public/topic/xrp/v1', {
    headers: { 'Authorization': 'Bearer YOUR_KEY' }
});

// After (works!)
const response = await fetch('https://your-app.onrender.com/api/xrp/all');
const { data } = await response.json();

// Access data
console.log(data.topic);      // Social metrics
console.log(data.posts);      // Top posts
console.log(data.timeseries); // Historical data
console.log(data.coin);       // Market data
console.log(data.news);       // News articles
```

## Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Set API key
export LUNARCRUSH_API_KEY=your-api-key

# Run locally
python app.py

# Test
curl http://localhost:5000/api/xrp/all
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `LUNARCRUSH_API_KEY` | Your LunarCrush API key | Yes |
| `PORT` | Server port (default: 5000) | No |

## Response Format

All endpoints return:
```json
{
    "data": { ... },
    "cached": true/false
}
```

## Rate Limiting

- LunarCrush API has rate limits
- This proxy caches responses for 5 minutes
- The `/api/xrp/all` endpoint is most efficient (one cache, all data)
