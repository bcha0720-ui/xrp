// =====================================================
// XRP ETF Tracker - Complete Backend Server
// Includes: ETF Data API + Claude AI Insights + On-Chain + Chat
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
// KNOWLEDGE BASE FOR RAG (Chat Enhancement)
// =====================================================

const knowledgeBase = [
    { id: 'xrp-1', category: 'xrp', title: 'What is XRP', content: 'XRP is a digital asset native to the XRP Ledger (XRPL). Created in 2012 for fast, low-cost payments. Transactions settle in 3-5 seconds. Total supply capped at 100 billion XRP.' },
    { id: 'xrp-2', category: 'xrp', title: 'XRP Escrow', content: 'Ripple holds ~40-45 billion XRP in escrow with 1 billion released monthly. Unused portions return to escrow. This provides supply transparency.' },
    { id: 'xrp-3', category: 'xrp', title: 'XRP Use Cases', content: 'Main uses: Cross-border payments via ODL, bridge currency, XRPL DEX trading, NFTs, smart contracts via Hooks. Used by financial institutions for remittances.' },
    { id: 'etf-1', category: 'etf', title: 'XRP ETF Overview', content: 'XRP ETF tracks XRP price on stock exchanges. Allows exposure without holding crypto directly. Provides institutional custody and regulatory compliance.' },
    { id: 'etf-2', category: 'etf', title: 'ETF Applications', content: 'Filers include: Grayscale, Bitwise, 21Shares, Canary Capital, WisdomTree, Franklin Templeton. Includes 19b-4 and S-1 filings. SEC has 240 days to decide.' },
    { id: 'etf-3', category: 'etf', title: 'Grayscale XRP Trust', content: 'GXRP launched as private placement, filed to convert to spot ETF. Grayscale successfully converted GBTC in January 2024.' },
    { id: 'sec-1', category: 'regulation', title: 'SEC vs Ripple', content: 'SEC sued Ripple in Dec 2020. July 2023: Judge ruled programmatic exchange sales are NOT securities. Ripple fined $125M. Largely favorable ruling for XRP.' },
    { id: 'sec-2', category: 'regulation', title: 'XRP Legal Status', content: 'Post-ruling: Secondary market XRP sales are not securities transactions. This enabled exchange relistings and ETF applications.' },
    { id: 'tech-1', category: 'technical', title: 'XRPL Consensus', content: 'Uses unique consensus protocol with trusted validators. 3-5 second finality. 1,500+ TPS capacity. Validators run by universities, exchanges, institutions.' },
    { id: 'market-1', category: 'market', title: 'XRP Price Factors', content: 'Key factors: Crypto market sentiment, BTC correlation, SEC developments, ETF progress, ODL adoption, escrow releases, institutional adoption, global regulation.' }
];

function findRelevantDocs(query, topK = 3) {
    const queryLower = query.toLowerCase();
    const words = queryLower.split(/\s+/).filter(w => w.length > 3);
    
    return knowledgeBase.map(doc => {
        const content = (doc.title + ' ' + doc.content).toLowerCase();
        let score = words.filter(w => content.includes(w)).length;
        if (queryLower.includes('etf') && doc.category === 'etf') score += 3;
        if (queryLower.includes('sec') && doc.category === 'regulation') score += 3;
        if ((queryLower.includes('escrow') || queryLower.includes('supply')) && content.includes('escrow')) score += 3;
        if ((queryLower.includes('filing') || queryLower.includes('application')) && doc.category === 'etf') score += 2;
        return { ...doc, score };
    }).sort((a, b) => b.score - a.score).slice(0, topK).filter(d => d.score > 0);
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
// CACHES
// =====================================================

let etfDataCache = { data: null, timestamp: null };
const ETF_CACHE_DURATION = 60 * 1000; // 1 minute

let insightCache = { data: null, timestamp: 0 };
const AI_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

let onChainCache = { escrow: null, network: null, lastUpdate: null };
const ONCHAIN_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS = 10;

function isRateLimited(ip) {
    const now = Date.now();
    const requests = rateLimitMap.get(ip) || [];
    const recentRequests = requests.filter(t => t > now - RATE_LIMIT_WINDOW);
    if (recentRequests.length >= MAX_REQUESTS) return true;
    recentRequests.push(now);
    rateLimitMap.set(ip, recentRequests);
    return false;
}

// =====================================================
// FETCH ETF DATA FROM YAHOO FINANCE
// =====================================================

async function fetchYahooFinanceData(symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`;
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        const result = data.chart?.result?.[0];
        if (!result) return null;
        
        const meta = result.meta;
        const quotes = result.indicators?.quote?.[0];
        const timestamps = result.timestamp || [];
        
        if (!quotes || !timestamps.length) return null;
        
        const price = meta.regularMarketPrice || quotes.close?.[quotes.close.length - 1] || 0;
        const volumes = quotes.volume || [];
        
        const dailyShares = volumes[volumes.length - 1] || 0;
        const weeklyShares = volumes.slice(-5).reduce((a, b) => a + (b || 0), 0);
        const monthlyShares = volumes.slice(-21).reduce((a, b) => a + (b || 0), 0);
        const yearlyShares = volumes.slice(-252).reduce((a, b) => a + (b || 0), 0);
        
        return {
            symbol,
            description: DESCRIPTIONS[symbol] || symbol,
            price: price,
            daily: { shares: dailyShares, dollars: dailyShares * price },
            weekly: { shares: weeklyShares, dollars: weeklyShares * price },
            monthly: { shares: monthlyShares, dollars: monthlyShares * price },
            yearly: { shares: yearlyShares, dollars: yearlyShares * price }
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
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        results[groupName] = groupData;
    }
    return results;
}

// =====================================================
// API ENDPOINTS - CORE
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
            'POST /api/chat',
            'GET /api/onchain/escrow',
            'GET /api/onchain/network',
            'GET /api/onchain/odl',
            'GET /api/onchain/dex'
        ],
        aiEnabled: !!anthropic
    });
});

// ETF Data endpoint
app.get('/api/etf-data', async (req, res) => {
    try {
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
        etfDataCache = { data: data, timestamp: Date.now() };
        
        res.json({
            data: data,
            timestamp: new Date().toISOString(),
            cached: false
        });
    } catch (error) {
        console.error('ETF Data Error:', error);
        if (etfDataCache.data) {
            return res.json({
                data: etfDataCache.data,
                timestamp: new Date(etfDataCache.timestamp).toISOString(),
                cached: true,
                stale: true
            });
        }
        res.status(500).json({ error: 'Failed to fetch ETF data' });
    }
});

// Historical data endpoint
app.get('/api/historical', async (req, res) => {
    const period = req.query.period || '1mo';
    const validPeriods = ['1mo', '3mo', '6mo', '1y'];
    if (!validPeriods.includes(period)) {
        return res.status(400).json({ error: 'Invalid period' });
    }
    
    try {
        const symbol = 'GXRP';
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${period}`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        const result = data.chart?.result?.[0];
        
        res.json({
            symbol,
            period,
            timestamps: result?.timestamp || [],
            prices: result?.indicators?.quote?.[0]?.close || [],
            volumes: result?.indicators?.quote?.[0]?.volume || []
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch historical data' });
    }
});

// =====================================================
// AI INSIGHTS ENDPOINT
// =====================================================

app.post('/api/ai-insights', async (req, res) => {
    if (!anthropic) {
        return res.status(503).json({
            error: 'AI insights not available',
            message: 'ANTHROPIC_API_KEY not configured'
        });
    }
    
    try {
        const clientIP = req.ip || req.connection?.remoteAddress || 'unknown';
        if (isRateLimited(clientIP)) {
            return res.status(429).json({ error: 'Rate limited', retryAfter: 60 });
        }

        const { marketData, forceRefresh } = req.body;
        if (!marketData) {
            return res.status(400).json({ error: 'Market data is required' });
        }

        if (!forceRefresh && insightCache.data && (Date.now() - insightCache.timestamp) < AI_CACHE_DURATION) {
            return res.json({
                success: true,
                analysis: insightCache.data,
                cached: true
            });
        }

        const prompt = buildInsightPrompt(marketData);
        console.log('Calling Claude AI for insights...');
        
        const message = await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 1000,
            messages: [{ role: 'user', content: prompt }]
        });

        const analysis = message.content[0].text;
        insightCache = { data: analysis, timestamp: Date.now() };

        res.json({
            success: true,
            analysis: analysis,
            cached: false
        });
    } catch (error) {
        console.error('AI Insights Error:', error.message);
        if (insightCache.data) {
            return res.json({
                success: true,
                analysis: insightCache.data,
                cached: true,
                stale: true
            });
        }
        res.status(500).json({ error: 'Failed to generate insights' });
    }
});

// =====================================================
// CHAT ENDPOINT (Enhanced with RAG)
// =====================================================

app.post('/api/chat', async (req, res) => {
    if (!anthropic) {
        return res.json({ success: false, error: 'AI not configured' });
    }

    try {
        const { question, marketData, language = 'en' } = req.body;
        
        // Find relevant knowledge base documents
        const relevantDocs = findRelevantDocs(question, 3);
        const ragContext = relevantDocs.length > 0 
            ? relevantDocs.map(d => `[${d.title}]: ${d.content}`).join('\n\n')
            : '';

        const langInstruction = language === 'ko' ? 'Respond in Korean.' 
            : language === 'ja' ? 'Respond in Japanese.' : 'Respond in English.';

        const prompt = `You are a helpful XRP AI assistant. ${langInstruction}

## Current Market Data
- Price: $${(marketData?.currentPrice || 0).toFixed(4)}
- 24h Change: ${(marketData?.priceChange24h || 0).toFixed(2)}%
- 7d Change: ${(marketData?.priceChange7d || 0).toFixed(2)}%
- 7d MA: $${(marketData?.ma7 || 0).toFixed(4)}
- 30d MA: $${(marketData?.ma30 || 0).toFixed(4)}
- Sentiment: ${marketData?.sentiment || 50}/100

${ragContext ? `## Knowledge Base\n${ragContext}\n` : ''}

## Question
${question}

Be concise (under 150 words). Use HTML formatting (<br>, <strong>, <em>). Add disclaimer for financial questions.`;

        const message = await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 512,
            messages: [{ role: 'user', content: prompt }]
        });

        res.json({
            success: true,
            reply: message.content[0].text,
            sourcesUsed: relevantDocs.map(d => d.title)
        });
    } catch (error) {
        console.error('Chat error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// =====================================================
// ON-CHAIN ANALYTICS ENDPOINTS
// =====================================================

// Escrow data
app.get('/api/onchain/escrow', async (req, res) => {
    try {
        if (onChainCache.escrow && onChainCache.lastUpdate && 
            Date.now() - onChainCache.lastUpdate < ONCHAIN_CACHE_DURATION) {
            return res.json({ success: true, data: onChainCache.escrow, cached: true });
        }

        const response = await fetch('https://s1.ripple.com:51234/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method: 'account_info',
                params: [{ account: 'rEhKZcz5Ndjm9BzZmmKrtvhXPnSWByssDv', ledger_index: 'validated' }]
            })
        });

        const data = await response.json();
        if (data.result?.account_data) {
            const balance = parseInt(data.result.account_data.Balance) / 1000000;
            const escrowData = {
                totalEscrow: balance,
                monthlyRelease: 1000000000,
                releasesRemaining: Math.ceil(balance / 1000000000),
                nextReleaseDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().split('T')[0]
            };
            onChainCache.escrow = escrowData;
            onChainCache.lastUpdate = Date.now();
            res.json({ success: true, data: escrowData });
        } else {
            throw new Error('Invalid XRPL response');
        }
    } catch (error) {
        console.error('Escrow error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// Network stats
app.get('/api/onchain/network', async (req, res) => {
    try {
        if (onChainCache.network && onChainCache.lastUpdate &&
            Date.now() - onChainCache.lastUpdate < ONCHAIN_CACHE_DURATION) {
            return res.json({ success: true, data: onChainCache.network, cached: true });
        }

        const response = await fetch('https://s1.ripple.com:51234/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'server_info', params: [{}] })
        });

        const data = await response.json();
        if (data.result?.info) {
            const info = data.result.info;
            const networkStats = {
                ledgerIndex: info.validated_ledger?.seq || 0,
                reserveBase: info.validated_ledger?.reserve_base_xrp || 10,
                reserveInc: info.validated_ledger?.reserve_inc_xrp || 2,
                serverState: info.server_state,
                uptime: info.uptime,
                peerCount: info.peers || 'N/A'
            };
            onChainCache.network = networkStats;
            res.json({ success: true, data: networkStats });
        } else {
            throw new Error('Invalid response');
        }
    } catch (error) {
        console.error('Network error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// ODL corridors
app.get('/api/onchain/odl', async (req, res) => {
    const corridors = [
        { name: 'Mexico (Bitso)', pair: 'USD/MXN', exchange: 'Bitso', status: 'active' },
        { name: 'Philippines (Coins.ph)', pair: 'USD/PHP', exchange: 'Coins.ph', status: 'active' },
        { name: 'Australia (BTC Markets)', pair: 'USD/AUD', exchange: 'BTC Markets', status: 'active' },
        { name: 'Japan (SBI VC)', pair: 'USD/JPY', exchange: 'SBI VC Trade', status: 'active' },
        { name: 'Brazil', pair: 'USD/BRL', exchange: 'Mercado Bitcoin', status: 'active' },
        { name: 'Europe (Bitstamp)', pair: 'USD/EUR', exchange: 'Bitstamp', status: 'active' }
    ];
    res.json({ success: true, data: { corridors } });
});

// DEX stats
app.get('/api/onchain/dex', async (req, res) => {
    try {
        const response = await fetch('https://s1.ripple.com:51234/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method: 'book_offers',
                params: [{
                    taker_pays: { currency: 'XRP' },
                    taker_gets: { currency: 'USD', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' },
                    limit: 20
                }]
            })
        });

        const data = await response.json();
        let totalLiquidity = 0, orderCount = 0;
        
        if (data.result?.offers) {
            orderCount = data.result.offers.length;
            data.result.offers.forEach(offer => {
                totalLiquidity += parseInt(offer.TakerPays) / 1000000;
            });
        }

        res.json({
            success: true,
            data: {
                xrpUsdLiquidity: totalLiquidity,
                activeOrders: orderCount,
                pairs: [
                    { pair: 'XRP/USD', liquidity: totalLiquidity, orders: orderCount },
                    { pair: 'XRP/EUR', liquidity: 'N/A', orders: 0 },
                    { pair: 'XRP/BTC', liquidity: 'N/A', orders: 0 }
                ]
            }
        });
    } catch (error) {
        console.error('DEX error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// AI Health check
app.get('/api/ai-insights/health', (req, res) => {
    res.json({
        status: 'ok',
        aiEnabled: !!anthropic,
        hasApiKey: !!process.env.ANTHROPIC_API_KEY
    });
});

// =====================================================
// PROMPT BUILDER
// =====================================================

function buildInsightPrompt(data) {
    const {
        currentPrice = 0, priceChange24h = 0, priceChange7d = 0, priceChange30d = 0,
        volume24h = 0, ma7 = 0, ma30 = 0, ma90 = 0,
        etfHoldings = 0, exchangeHoldings = 0, etfVolume = 0, sentimentScore = 50
    } = data;

    return `You are an expert XRP market analyst. Analyze this data and provide professional insights.

## CURRENT XRP MARKET DATA
- Current Price: $${currentPrice.toFixed(4)}
- 24h Change: ${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}%
- 7-Day Change: ${priceChange7d >= 0 ? '+' : ''}${priceChange7d.toFixed(2)}%
- 30-Day Change: ${priceChange30d >= 0 ? '+' : ''}${priceChange30d.toFixed(2)}%
- 7-Day MA: $${ma7.toFixed(4)} (Price is ${currentPrice > ma7 ? 'Above' : 'Below'})
- 30-Day MA: $${ma30.toFixed(4)} (Price is ${currentPrice > ma30 ? 'Above' : 'Below'})
- 90-Day MA: ${ma90 > 0 ? '$' + ma90.toFixed(4) : 'N/A'}
- ETF Holdings: ${formatLargeNumber(etfHoldings)} XRP
- Exchange Holdings: ${formatLargeNumber(exchangeHoldings)} XRP
- Sentiment: ${sentimentScore}/100

Provide 4 paragraphs: Market Overview, Technical Analysis, Institutional Flow, Outlook.
Be concise, use specific numbers, no bullet points.`;
}

function formatLargeNumber(num) {
    if (!num || num === 0) return '0';
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toLocaleString();
}

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {
    console.log('=========================================');
    console.log(`🚀 XRP ETF Tracker API running on port ${PORT}`);
    console.log('=========================================');
    console.log('Endpoints:');
    console.log('  GET  /api/etf-data');
    console.log('  GET  /api/historical');
    console.log('  POST /api/ai-insights');
    console.log('  POST /api/chat');
    console.log('  GET  /api/onchain/escrow');
    console.log('  GET  /api/onchain/network');
    console.log('  GET  /api/onchain/odl');
    console.log('  GET  /api/onchain/dex');
    console.log('=========================================');
    console.log(`AI: ${anthropic ? '✅ Enabled' : '❌ Disabled'}`);
    console.log('=========================================');
});
