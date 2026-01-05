// =====================================================
// XRP ETF Tracker - Backend Server
// With AI Insights powered by Claude
// =====================================================

const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Anthropic client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// =====================================================
// Your existing ETF data endpoints go here
// (Keep all your current routes)
// =====================================================

// Example: app.get('/api/etf-data', ...)
// Example: app.get('/api/historical', ...)


// =====================================================
// NEW: AI Insights Endpoint
// =====================================================

// Cache for AI insights (reduces API calls)
let insightCache = {
    data: null,
    timestamp: 0
};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 10; // per minute per IP

function isRateLimited(ip) {
    const now = Date.now();
    const requests = rateLimitMap.get(ip) || [];
    const recentRequests = requests.filter(t => t > now - RATE_LIMIT_WINDOW);
    
    if (recentRequests.length >= MAX_REQUESTS) {
        return true;
    }
    
    recentRequests.push(now);
    rateLimitMap.set(ip, recentRequests);
    return false;
}

app.post('/api/ai-insights', async (req, res) => {
    try {
        // Check rate limit
        const clientIP = req.ip || req.connection.remoteAddress;
        if (isRateLimited(clientIP)) {
            return res.status(429).json({ 
                error: 'Rate limited',
                message: 'Too many requests. Please wait a minute.',
                retryAfter: 60
            });
        }

        const { marketData, forceRefresh } = req.body;

        if (!marketData) {
            return res.status(400).json({ error: 'Market data is required' });
        }

        // Check cache (unless force refresh)
        if (!forceRefresh && insightCache.data && (Date.now() - insightCache.timestamp) < CACHE_DURATION) {
            return res.json({
                success: true,
                analysis: insightCache.data,
                cached: true,
                cacheAge: Math.round((Date.now() - insightCache.timestamp) / 1000),
                timestamp: new Date(insightCache.timestamp).toISOString()
            });
        }

        // Build prompt
        const prompt = buildPrompt(marketData);

        // Call Claude API
        const message = await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 1000,
            messages: [{ role: 'user', content: prompt }]
        });

        const analysis = message.content[0].text;

        // Update cache
        insightCache = {
            data: analysis,
            timestamp: Date.now()
        };

        res.json({
            success: true,
            analysis: analysis,
            cached: false,
            model: 'claude-3-5-haiku',
            timestamp: new Date().toISOString(),
            usage: {
                inputTokens: message.usage.input_tokens,
                outputTokens: message.usage.output_tokens
            }
        });

    } catch (error) {
        console.error('AI Insights Error:', error.message);
        
        // Return cached data if available, even if expired
        if (insightCache.data) {
            return res.json({
                success: true,
                analysis: insightCache.data,
                cached: true,
                stale: true,
                error: 'Using cached data due to API error'
            });
        }

        res.status(500).json({
            error: 'Failed to generate insights',
            message: error.message
        });
    }
});

// Health check for AI endpoint
app.get('/api/ai-insights/health', (req, res) => {
    res.json({
        status: 'ok',
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
        cacheStatus: insightCache.data ? 'has_cache' : 'empty',
        cacheAge: insightCache.timestamp ? Math.round((Date.now() - insightCache.timestamp) / 1000) : null
    });
});


// =====================================================
// Prompt Builder
// =====================================================

function buildPrompt(data) {
    const {
        currentPrice = 0,
        priceChange24h = 0,
        priceChange7d = 0,
        priceChange30d = 0,
        volume24h = 0,
        ma7 = 0,
        ma30 = 0,
        ma90 = 0,
        etfHoldings = 0,
        exchangeHoldings = 0,
        etfVolume = 0,
        sentimentScore = 50
    } = data;

    const priceVsMa7 = currentPrice > ma7 ? 'Above' : 'Below';
    const priceVsMa30 = currentPrice > ma30 ? 'Above' : 'Below';
    const priceVsMa90 = ma90 > 0 ? (currentPrice > ma90 ? 'Above' : 'Below') : 'N/A';

    return `You are an expert cryptocurrency market analyst specializing in XRP and crypto ETFs. Analyze the following real-time market data and provide professional insights.

## CURRENT XRP MARKET DATA

### Price Information
- Current Price: $${currentPrice.toFixed(4)}
- 24h Change: ${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}%
- 7-Day Change: ${priceChange7d >= 0 ? '+' : ''}${priceChange7d.toFixed(2)}%
- 30-Day Change: ${priceChange30d >= 0 ? '+' : ''}${priceChange30d.toFixed(2)}%
- 24h Trading Volume: $${formatLargeNumber(volume24h)}

### Technical Indicators
- 7-Day Moving Average: $${ma7.toFixed(4)} (Price is ${priceVsMa7})
- 30-Day Moving Average: $${ma30.toFixed(4)} (Price is ${priceVsMa30})
- 90-Day Moving Average: $${ma90 > 0 ? ma90.toFixed(4) : 'N/A'} (Price is ${priceVsMa90})

### Institutional & Exchange Data
- Total XRP in Spot ETFs: ${formatLargeNumber(etfHoldings)} XRP (≈$${formatLargeNumber(etfHoldings * currentPrice)})
- ETF Daily Trading Volume: $${formatLargeNumber(etfVolume)}
- XRP on Exchanges: ${formatLargeNumber(exchangeHoldings)} XRP

### Calculated Sentiment: ${sentimentScore}/100 (${getSentimentLabel(sentimentScore)})

---

## YOUR TASK

Provide a professional market analysis in **4 paragraphs**:

1. **Market Overview**: Summarize the current state of XRP - price action, momentum, and what the numbers tell us.

2. **Technical Analysis**: Interpret the moving averages and price position. What do the MA crossovers or divergences suggest? Identify key support/resistance levels based on the MAs.

3. **Institutional Flow Analysis**: Analyze the ETF holdings and exchange data. What does decreasing/increasing exchange holdings suggest? How significant is the ETF activity?

4. **Outlook & Key Levels**: Provide a short-term outlook (1-2 weeks). Mention specific price levels to watch (support/resistance). Include any risks or catalysts to monitor.

**Guidelines:**
- Be concise but insightful
- Use specific numbers from the data
- Avoid generic statements
- No bullet points - write in flowing paragraphs
- Professional tone suitable for informed investors
- End with a clear, actionable takeaway`;
}

function formatLargeNumber(num) {
    if (!num || num === 0) return '0';
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
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
// Start Server
// =====================================================

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`AI Insights: ${process.env.ANTHROPIC_API_KEY ? 'Enabled' : 'DISABLED - No API key'}`);
});
