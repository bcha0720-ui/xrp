// =====================================================
// XRP ETF Tracker - Complete Backend Server
// Includes: ETF Data API + Claude AI Insights
// =====================================================

const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Anthropic client (only if API key exists)
let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
    anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
    });
    console.log('✅ Anthropic AI enabled');
} else {
    console.log('⚠️ No ANTHROPIC_API_KEY - AI insights disabled');
}

// =====================================================
// ETF SYMBOLS CONFIGURATION
// =====================================================

const ETF_SYMBOLS = {
    'XRP Spot ETFs': ['GXRP', 'XRP', 'XRPC', 'XRPZ', 'TOXR', 'XRPR'],
    'XRP Leveraged ETFs': ['UXRP', 'XRPI', 'XRPM', 'XRPK', 'XRPT', 'XXRP'],
    'XRP Canadian ETFs': ['XRP.TO', 'XRPP-B.TO', 'XRPP-U.TO', 'XRPP.TO', 'XRPQ-U.TO', 'XRPQ.TO'],
    'Bitcoin Spot ETFs': ['IBIT', 'FBTC', 'GBTC', 'ARKB', 'BITB', 'HODL', 'BRRR', 'EZBC', 'BTCW', 'BTCO'],
    'Ethereum Spot ETFs': ['ETHA', 'FETH', 'ETHE', 'ETHW', 'CETH', 'ETHV', 'QETH', 'EZET'],
    'Crypto Index ETFs': ['GDLC', 'NCIQ', 'BITW', 'EZPZ']
};

const DESCRIPTIONS = {
    'EZPZ': 'Franklin Templeton',
    'GDLC': 'Grayscale Digital Large Cap',
    'NCIQ': 'Hashdex Nasdaq Crypto Index',
    'BITW': 'Bitwise 10 Crypto Index',
    'GXRP': 'Grayscale XRP Trust',
    'XRP': 'Bitwise XRP ETF',
    'XRPC': 'Canary Capital XRP',
    'XRPZ': 'Franklin XRP ETF',
    'TOXR': '21Shares XRP',
    'UXRP': 'ProShares Ultra XRP',
    'XRPI': 'Volatility Shares Trust',
    'XRPM': 'Amplify XRP',
    'XRPR': 'REX-Osprey XRP',
    'XRPK': 'T-REX 2X Long XRP',
    'XRPT': 'Volatility Shares 2x XRP',
    'XXRP': 'Teucrium 2x Long XRP',
    'IBIT': 'iShares Bitcoin Trust',
    'FBTC': 'Fidelity Wise Origin Bitcoin',
    'GBTC': 'Grayscale Bitcoin Trust',
    'ARKB': 'ARK 21Shares Bitcoin',
    'ETHA': 'iShares Ethereum Trust',
    'FETH': 'Fidelity Ethereum Fund',
    'ETHE': 'Grayscale Ethereum Trust'
};

// =====================================================
// CACHE FOR ETF DATA
// =====================================================

let etfDataCache = {
    data: null,
    timestamp: null
};
const ETF_CACHE_DURATION = 60 * 1000; // 1 minute

// =====================================================
// FETCH ETF DATA FROM YAHOO FINANCE
// =====================================================

const yahooFinance = require('yahoo-finance2').default;

async function fetchYahooFinanceData(symbol) {
    try {
        // yahoo-finance2 handles the headers and crumbs for you
        const result = await yahooFinance.chart(symbol, { period1: '2025-01-01', interval: '1d' });
        
        if (!result || !result.meta) return null;

        const price = result.meta.regularMarketPrice;
        const quotes = result.indicators.quote[0];
        // ... rest of your calculation logic ...
    } catch (error) {
        console.error(`Error fetching ${symbol}:`, error.message);
        return null;
    }
}
        
        const meta = result.meta;
        const quotes = result.indicators?.quote?.[0];
        const timestamps = result.timestamp || [];
        
        if (!quotes || !timestamps.length) {
            return null;
        }
        
        // Get current price
        const price = meta.regularMarketPrice || quotes.close?.[quotes.close.length - 1] || 0;
        
        // Calculate volumes
        const volumes = quotes.volume || [];
        const closes = quotes.close || [];
        
        // Daily volume (last trading day)
        const dailyShares = volumes[volumes.length - 1] || 0;
        const dailyDollars = dailyShares * price;
        
        // Weekly volume (last 5 trading days)
        const weeklyShares = volumes.slice(-5).reduce((a, b) => a + (b || 0), 0);
        const weeklyDollars = weeklyShares * price;
        
        // Monthly volume (last 21 trading days)
        const monthlyShares = volumes.slice(-21).reduce((a, b) => a + (b || 0), 0);
        const monthlyDollars = monthlyShares * price;
        
        // Yearly volume (all available data up to 252 days)
        const yearlyShares = volumes.slice(-252).reduce((a, b) => a + (b || 0), 0);
        const yearlyDollars = yearlyShares * price;
        
        return {
            symbol,
            description: DESCRIPTIONS[symbol] || symbol,
            price: price,
            daily: { shares: dailyShares, dollars: dailyDollars },
            weekly: { shares: weeklyShares, dollars: weeklyDollars },
            monthly: { shares: monthlyShares, dollars: monthlyDollars },
            yearly: { shares: yearlyShares, dollars: yearlyDollars }
        };
        
    } catch (error) {
        console.error(`Error fetching ${symbol}:`, error.message);
        return null;
    }
}

async function fetchAllETFData() {
    const results = {};
    
    for (const [groupName, symbols] of Object.entries(ETF_SYMBOLS)) {
        const groupData = [];
        
        for (const symbol of symbols) {
            const data = await fetchYahooFinanceData(symbol);
            if (data) {
                groupData.push(data);
            }
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        results[groupName] = groupData;
    }
    
    return results;
}

// =====================================================
// API ENDPOINTS
// =====================================================

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'XRP ETF Tracker API',
        endpoints: [
            'GET /api/etf-data',
            'GET /api/historical',
            'POST /api/ai-insights',
            'GET /api/ai-insights/health'
        ],
        aiEnabled: !!anthropic
    });
});

// ETF Data endpoint
app.get('/api/etf-data', async (req, res) => {
    try {
        // Check cache
        if (etfDataCache.data && etfDataCache.timestamp) {
            const cacheAge = Date.now() - etfDataCache.timestamp;
            if (cacheAge < ETF_CACHE_DURATION) {
                return res.json({
                    data: etfDataCache.data,
                    timestamp: new Date(etfDataCache.timestamp).toISOString(),
                    cached: true,
                    cacheAge: Math.round(cacheAge / 1000)
                });
            }
        }
        
        console.log('Fetching fresh ETF data...');
        const data = await fetchAllETFData();
        
        // Update cache
        etfDataCache = {
            data: data,
            timestamp: Date.now()
        };
        
        res.json({
            data: data,
            timestamp: new Date().toISOString(),
            cached: false
        });
        
    } catch (error) {
        console.error('ETF Data Error:', error);
        
        // Return cached data if available
        if (etfDataCache.data) {
            return res.json({
                data: etfDataCache.data,
                timestamp: new Date(etfDataCache.timestamp).toISOString(),
                cached: true,
                stale: true,
                error: 'Using cached data due to fetch error'
            });
        }
        
        res.status(500).json({ error: 'Failed to fetch ETF data' });
    }
});

// Historical data endpoint (simplified)
app.get('/api/historical', async (req, res) => {
    const period = req.query.period || '1mo';
    
    try {
        // Fetch historical data for main XRP ETFs
        const symbols = ['GXRP', 'XRP', 'XRPC', 'XRPZ'];
        const results = {};
        
        for (const symbol of symbols) {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${period}`;
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                const result = data.chart?.result?.[0];
                
                if (result) {
                    const timestamps = result.timestamp || [];
                    const quotes = result.indicators?.quote?.[0] || {};
                    
                    results[symbol] = timestamps.map((ts, i) => ({
                        date: new Date(ts * 1000).toISOString().split('T')[0],
                        price: quotes.close?.[i] || 0,
                        volume: quotes.volume?.[i] || 0
                    }));
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        res.json({
            data: results,
            period: period,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Historical Data Error:', error);
        res.status(500).json({ error: 'Failed to fetch historical data' });
    }
});

// =====================================================
// AI INSIGHTS ENDPOINT
// =====================================================

// Cache for AI insights
let insightCache = {
    data: null,
    timestamp: 0
};
const AI_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

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
    // Check if AI is enabled
    if (!anthropic) {
        return res.status(503).json({
            error: 'AI insights not available',
            message: 'ANTHROPIC_API_KEY not configured'
        });
    }
    
    try {
        // Check rate limit
        const clientIP = req.ip || req.connection?.remoteAddress || 'unknown';
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
        if (!forceRefresh && insightCache.data && (Date.now() - insightCache.timestamp) < AI_CACHE_DURATION) {
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

        console.log('Calling Claude AI...');
        
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
        
        // Return cached data if available
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

// AI Health check
app.get('/api/ai-insights/health', (req, res) => {
    res.json({
        status: 'ok',
        aiEnabled: !!anthropic,
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
        cacheStatus: insightCache.data ? 'has_cache' : 'empty',
        cacheAge: insightCache.timestamp ? Math.round((Date.now() - insightCache.timestamp) / 1000) : null
    });
});

// =====================================================
// PROMPT BUILDER
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
- 90-Day Moving Average: ${ma90 > 0 ? '$' + ma90.toFixed(4) : 'N/A'} (Price is ${priceVsMa90})

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
// START SERVER
// =====================================================

app.listen(PORT, () => {
    console.log('=========================================');
    console.log(`🚀 XRP ETF Tracker API running on port ${PORT}`);
    console.log('=========================================');
    console.log('Endpoints:');
    console.log(`  GET  /api/etf-data`);
    console.log(`  GET  /api/historical?period=1mo`);
    console.log(`  POST /api/ai-insights`);
    console.log(`  GET  /api/ai-insights/health`);
    console.log('=========================================');
    console.log(`AI Insights: ${anthropic ? '✅ Enabled' : '❌ Disabled (no API key)'}`);
    console.log('=========================================');
});
