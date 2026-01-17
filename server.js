// =====================================================
// XRP ETF Tracker - Complete Backend Server (Fixed)
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
// ETF SYMBOLS & DESCRIPTIONS
// =====================================================

// Change these keys to match your frontend mapping exactly
const ETF_SYMBOLS = {
    'Spot ETFs': ['GXRP', 'XRP', 'XRPC', 'XRPZ', 'TOXR', 'XRPR'],
    'Futures ETFs': ['UXRP', 'XRPI', 'XRPM', 'XRPK', 'XRPT', 'XXRP'], // Changed from Leveraged
    'Canada ETFs': ['XRP.TO', 'XRPP-B.TO', 'XRPP-U.TO', 'XRPP.TO', 'XRPQ-U.TO', 'XRPQ.TO'],
    'Index ETFs': ['GDLC', 'NCIQ', 'BITW', 'EZPZ']
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
    'XXRP': 'Teucrium 2x Long XRP'
};

// Cache
let etfDataCache = { data: null, timestamp: null };
const ETF_CACHE_DURATION = 60 * 1000;

// =====================================================
// DATA FETCHING LOGIC
// =====================================================

async function fetchYahooFinanceData(symbol) {
    try {
        // Using query2 for better reliability
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`;
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        const result = data.chart?.result?.[0];
        
        if (!result) return null;
        
        const meta = result.meta;
        const quotes = result.indicators?.quote?.[0];
        const volumes = quotes?.volume || [];
        const price = meta.regularMarketPrice || (quotes?.close ? quotes.close[quotes.close.length - 1] : 0);
        
        return {
            symbol,
            description: DESCRIPTIONS[symbol] || symbol,
            price: price,
            daily: { shares: volumes[volumes.length - 1] || 0, dollars: (volumes[volumes.length - 1] || 0) * price },
            weekly: { 
                shares: volumes.slice(-5).reduce((a, b) => a + (b || 0), 0),
                dollars: volumes.slice(-5).reduce((a, b) => a + (b || 0), 0) * price 
            }
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
            if (data) groupData.push(data);
            await new Promise(resolve => setTimeout(resolve, 150));
        }
        results[groupName] = groupData;
    }
    return results;
}

// =====================================================
// API ENDPOINTS
// =====================================================

app.get('/api/etf-data', async (req, res) => {
    try {
        if (etfDataCache.data && (Date.now() - etfDataCache.timestamp < ETF_CACHE_DURATION)) {
            return res.json({ data: etfDataCache.data, cached: true });
        }
        const data = await fetchAllETFData();
        etfDataCache = { data, timestamp: Date.now() };
        res.json({ data, cached: false });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/historical', async (req, res) => {
    const period = req.query.period || '1mo';
    try {
        const symbols = ['GXRP', 'XRP', 'XRPC', 'XRPZ'];
        const results = {};
        for (const symbol of symbols) {
            const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${period}`;
            const response = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (response.ok) {
                const data = await response.json();
                const result = data.chart?.result?.[0];
                if (result) {
                    const ts = result.timestamp || [];
                    const q = result.indicators?.quote?.[0] || {};
                    results[symbol] = ts.map((t, i) => ({
                        date: new Date(t * 1000).toISOString().split('T')[0],
                        price: q.close?.[i] || 0
                    }));
                }
            }
        }
        res.json({ data: results, period });
    } catch (error) {
        res.status(500).json({ error: 'Historical fetch failed' });
    }
});

// AI Insights Logic (Shortened for brevity)
app.post('/api/ai-insights', async (req, res) => {
    if (!anthropic) return res.status(503).json({ error: 'AI disabled' });
    try {
        const { marketData } = req.body;
        const message = await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 1000,
            messages: [{ role: 'user', content: `Analyze this market data: ${JSON.stringify(marketData)}` }]
        });
        res.json({ analysis: message.content[0].text });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
