// =====================================================
// AI INSIGHTS ENDPOINT - Add to your existing Express server
// =====================================================

// 1. First, install the Anthropic SDK:
//    npm install @anthropic-ai/sdk

// 2. Add this import at the top of your server file:
const Anthropic = require('@anthropic-ai/sdk');

// 3. Initialize the client (add near your other initializations):
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY  // Set this in Render environment variables
});

// 4. Add this endpoint to your Express app:

app.post('/api/ai-insights', async (req, res) => {
    try {
        const { marketData } = req.body;
        
        if (!marketData) {
            return res.status(400).json({ error: 'Market data required' });
        }

        // Build the prompt with real market data
        const prompt = buildInsightPrompt(marketData);
        
        // Call Claude API
        const message = await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022',  // Fast & cheap
            max_tokens: 800,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ]
        });

        // Extract the text response
        const analysis = message.content[0].text;

        res.json({
            success: true,
            analysis: analysis,
            model: 'claude-3-5-haiku',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('AI Insights Error:', error);
        res.status(500).json({ 
            error: 'Failed to generate insights',
            message: error.message 
        });
    }
});

// Helper function to build the prompt
function buildInsightPrompt(data) {
    return `You are an expert crypto market analyst. Analyze the following XRP market data and provide actionable insights.

## Current Market Data:
- **XRP Price:** $${data.currentPrice?.toFixed(4) || 'N/A'}
- **24h Change:** ${data.priceChange24h?.toFixed(2) || 'N/A'}%
- **7d Change:** ${data.priceChange7d?.toFixed(2) || 'N/A'}%
- **30d Change:** ${data.priceChange30d?.toFixed(2) || 'N/A'}%
- **24h Volume:** $${formatVolume(data.volume24h)}

## Technical Indicators:
- **7-Day MA:** $${data.ma7?.toFixed(4) || 'N/A'}
- **30-Day MA:** $${data.ma30?.toFixed(4) || 'N/A'}
- **90-Day MA:** $${data.ma90?.toFixed(4) || 'N/A'}
- **Price vs 7MA:** ${data.currentPrice > data.ma7 ? 'Above' : 'Below'}
- **Price vs 30MA:** ${data.currentPrice > data.ma30 ? 'Above' : 'Below'}

## ETF & Exchange Data:
- **XRP in Spot ETFs:** ${formatNumber(data.etfHoldings)} XRP (~$${formatVolume(data.etfHoldings * data.currentPrice)})
- **XRP on Exchanges:** ${formatNumber(data.exchangeHoldings)} XRP
${data.etfVolume ? `- **ETF Daily Volume:** $${formatVolume(data.etfVolume)}` : ''}

## Sentiment Score: ${data.sentimentScore}/100 (${getSentimentLabel(data.sentimentScore)})

---

Please provide a concise market analysis (3-4 paragraphs) covering:

1. **Market Overview** - Current price action and momentum
2. **Technical Analysis** - What the moving averages and indicators suggest
3. **ETF/Institutional Activity** - What the ETF and exchange flows indicate
4. **Outlook** - Short-term outlook with key levels to watch

Keep it professional but accessible. Use bullet points sparingly. Focus on actionable insights.`;
}

// Helper functions
function formatVolume(num) {
    if (!num) return 'N/A';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toFixed(2);
}

function formatNumber(num) {
    if (!num) return 'N/A';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toLocaleString();
}

function getSentimentLabel(score) {
    if (score >= 70) return 'Bullish';
    if (score >= 55) return 'Slightly Bullish';
    if (score >= 45) return 'Neutral';
    if (score >= 30) return 'Slightly Bearish';
    return 'Bearish';
}


// =====================================================
// OPTIONAL: Rate limiting to control costs
// =====================================================

// Simple in-memory rate limiter (add if needed)
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10; // 10 requests per minute

function checkRateLimit(ip) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;
    
    if (!rateLimit.has(ip)) {
        rateLimit.set(ip, []);
    }
    
    // Clean old entries
    const requests = rateLimit.get(ip).filter(time => time > windowStart);
    rateLimit.set(ip, requests);
    
    if (requests.length >= MAX_REQUESTS_PER_WINDOW) {
        return false; // Rate limited
    }
    
    requests.push(now);
    return true; // Allowed
}

// To use rate limiting, add this at the start of the endpoint:
// if (!checkRateLimit(req.ip)) {
//     return res.status(429).json({ error: 'Too many requests. Please wait.' });
// }


// =====================================================
// OPTIONAL: Caching to reduce API calls
// =====================================================

let cachedInsight = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// To use caching, wrap the API call:
// if (cachedInsight && (Date.now() - cacheTimestamp) < CACHE_DURATION) {
//     return res.json({ ...cachedInsight, cached: true });
// }
// ... make API call ...
// cachedInsight = response;
// cacheTimestamp = Date.now();
