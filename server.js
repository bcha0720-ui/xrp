// =====================================================
// XRP ETF Tracker - Complete Backend Server
// Includes: ETF Data API + Claude AI Insights + On-Chain + Chat + Email Reports
// =====================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (for PWA: manifest.json, sw.js, icons, index.html)
app.use(express.static(path.join(__dirname, '.')));

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
// EMAIL CONFIGURATION (Resend)
// =====================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_RECIPIENT = 'bcha0720@gmail.com';
const EMAIL_FROM = 'XRP Tracker <onboarding@resend.dev>'; // Use Resend's default for testing

// Schedule times in PST (converted to UTC for server)
// PST is UTC-8, so: 8AM PST = 16:00 UTC, 1PM PST = 21:00 UTC, 4PM PST = 00:00 UTC (next day)
const SCHEDULE_HOURS_UTC = [16, 21, 0]; // 8AM, 1PM, 4PM PST

let emailEnabled = false;
if (RESEND_API_KEY) {
    emailEnabled = true;
    console.log('✅ Email notifications enabled');
} else {
    console.log('⚠️ No RESEND_API_KEY - Email disabled');
}

// =====================================================
// COINGECKO API CONFIGURATION (FREE)
// =====================================================

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';

// CoinGecko cache (10 minute cache to avoid rate limits)
let coingeckoCache = {};
const COINGECKO_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Rate limiting - CoinGecko free tier allows 30 calls/minute
let lastCoinGeckoCall = 0;
const COINGECKO_MIN_INTERVAL = 2500; // 2.5 seconds between calls (24 calls/min max)

function getCoinGeckoCached(key, forceRefresh = false) {
    if (forceRefresh) {
        delete coingeckoCache[key];
        return null;
    }
    if (coingeckoCache[key]) {
        const { data, timestamp } = coingeckoCache[key];
        if (Date.now() - timestamp < COINGECKO_CACHE_DURATION) {
            return data;
        }
    }
    return null;
}

function setCoinGeckoCache(key, data) {
    coingeckoCache[key] = { data, timestamp: Date.now() };
}

function clearCoinGeckoCache() {
    coingeckoCache = {};
    console.log('CoinGecko cache cleared');
}

async function coingeckoRequest(endpoint) {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastCall = now - lastCoinGeckoCall;
    if (timeSinceLastCall < COINGECKO_MIN_INTERVAL) {
        const waitTime = COINGECKO_MIN_INTERVAL - timeSinceLastCall;
        console.log(`CoinGecko rate limit: waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    lastCoinGeckoCall = Date.now();
    
    const url = `${COINGECKO_BASE_URL}${endpoint}`;
    
    console.log(`CoinGecko request: ${url}`);
    
    try {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            }
        });
        
        console.log(`CoinGecko response status: ${response.status}`);
        
        if (response.status === 429) {
            console.log('CoinGecko rate limit hit - using cached data');
            return null;
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            console.log(`CoinGecko API error: ${response.status} - ${errorText}`);
            return null;
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('CoinGecko request failed:', error.message);
        return null;
    }
}

console.log('✅ CoinGecko API configured (FREE)');

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
    'Spot ETFs': ['GXRP', 'XRP', 'XRPC', 'XRPZ', 'TOXR', 'XRPR'],
    'Futures ETFs': ['UXRP', 'XRPI', 'XRPM', 'XRPK', 'XRPT', 'XXRP', 'XXX'],
    'Canada ETFs': ['XRP.TO', 'XRPP-B.TO', 'XRPP-U.TO', 'XRPP.TO', 'XRPQ-U.TO', 'XRPQ.TO', 'XRP.NE', 'XRPP.NE'],
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
    'XXRP': 'Teucrium 2x Long XRP',
    'XXX': 'Cyber Hornet S&P 500/XRP 75/25'
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

// Daily Holdings Trend Cache
let dailyHoldingsTrend = [];
let exchangeHoldingsCache = { data: null, timestamp: null };
const EXCHANGE_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// =====================================================
// EXCHANGE WALLETS CONFIGURATION
// =====================================================

const EXCHANGE_WALLETS = {
    "binance": {
        "rEy8TFcrAPvhpKrwyrscNYyqBGUkE9hKaJ": "Binance 1",
        "rNU4eAowPuixS5ZCWaRL72UUeKgxLyFjEA": "Binance 2",
        "rs8ZPbYqgecRcDzQpJYAMhSxSi5htsjnza": "Binance 3",
        "rsG1xG58dqEz8VVPL67gMwBdNb9jCuxuhv": "Binance 4",
        "rDvMQ76vWpuAPmf5Gk9MrPfaoW7113ibAw": "Binance 5",
        "rpQGn6Qra6xrViLueYN1R9v4sHSLPqw3PQ": "Binance 6",
        "r4G689g4KePYLKkyyumM1iUppTP4nhZwVC": "Binance 7",
        "rJo4m69u9Wd1F8fN2RbgAsJEF6a4hW1nSi": "Binance 8",
        "r9NpT9EBCjPMYfKXHMTqMLYmh8BeQREehY": "Binance 9",
        "r38a3PtqW3M7LRESgaR4dyHjg3AxAmiZCt": "Binance 10",
        "rDxJNbV23mu9xsWoQHoBqZQvc77YcbJXwb": "Binance 11",
        "rJWbw1u3oDDRcYLFqiWFjhGWRKVcBAWdgp": "Binance 12"
    },
    "uphold": {
        "rPz2qA93PeRCyHyFCqyNggnyycJR1N4iNf": "Uphold 1",
        "rU8xhU7n8wHfagwqaapVQtLQPmB7Gr4ivT": "Uphold 2",
        "rBc2pcENcLhYGdFKF3pqU2eowV9QsGQXe": "Uphold 3"
    },
    "bitso": {
        "rG6FZ31hDHN1K5Dkbma3PSB5uVCuVVRzfn": "Bitso 1",
        "rLSn6Z3T8uCxbcd1oxwfGQN1Fdn5CyGujK": "Bitso 2"
    },
    "kraken": {
        "rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh": "Kraken 1",
        "rUeDDFNp2q7Ymvyv75hFGC8DAcygVyJbNF": "Kraken 2"
    },
    "bitstamp": {
        "rp7TCczQuQo61dUo1oAgwdpRxLrA8vDaNV": "Bitstamp 1",
        "rrpNnNLKrartuEqfJGpqyDwPj1AFPg9vn1": "Bitstamp 2",
        "rGFuMiw48HdbnrUbkRYuitXTmfrDBNTCnX": "Bitstamp 3"
    },
    "coinbase": {
        "rw2ciyaNshpHe7bCHo4bRWq6pqqynnWKQg": "Coinbase 1"
    },
    "bithumb": {
        "rNxp4h8apvRis6mJf9Sh8C6iRxfrDWN7AV": "Bithumb 1",
        "rPJ5GFpyDLv7gqeB1uZVUBwDwi41kaXN5A": "Bithumb 2"
    },
    "bitbank": {
        "rMvCasZ9cohYrSZRNYPTZfoaaSUQMfgQ8G": "bitbank 1"
    },
    "huobi": {
        "rJn2zAPdFA193sixJwuFixRkYDUtx3apQh": "Huobi 1",
        "raQxZLtqurEXvH5sgijrif7yXMNwvFRkJN": "Huobi 2"
    },
    "okx": {
        "rwBHqnCgNRnk3Kyoc6zon6Wt4Wujj3HNGe": "OKX 1"
    },
    "upbit": {
        "rhWj9gaovwu2hZxYW7p388P8GRbuXFLQkK": "Upbit 1"
    },
    "sbi": {
        "rNRc2S2GSefSkTkAiyjE6LDzMonpeHp6jS": "SBI VC Trade 1",
        "rDDyH5nfvozKZQCwiBrWfcE528sWsBPWET": "SBI VC Trade 2"
    },
    "crypto_com": {
        "rUzpn3UpWvJT7gJp6UD3TkQSQSbHwNMtTL": "Crypto.com 1"
    },
    "kucoin": {
        "rBKz5MC2iXdoS3XgnNSYmF69K1Wo4NXGa": "KuCoin 1"
    },
    "gate_io": {
        "rHsZHqa5oMQNL5hFm4kfLd47aEMYjPstpg": "Gate.io 1"
    }
};

// =====================================================
// XRPL BALANCE FETCHING
// =====================================================

const XRPL_NODES = [
    'https://xrplcluster.com',
    'https://s1.ripple.com:51234',
    'https://s2.ripple.com:51234'
];

async function fetchXRPLBalance(address) {
    for (const node of XRPL_NODES) {
        try {
            const response = await fetch(node, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    method: 'account_info',
                    params: [{
                        account: address,
                        ledger_index: 'validated'
                    }]
                })
            });

            if (!response.ok) continue;

            const data = await response.json();
            if (data.result && data.result.account_data) {
                // Balance is in drops (1 XRP = 1,000,000 drops)
                return parseInt(data.result.account_data.Balance) / 1000000;
            }
        } catch (error) {
            console.log(`XRPL node ${node} failed for ${address}`);
        }
    }
    return null;
}

// =====================================================
// DAILY EXCHANGE HOLDINGS SNAPSHOT
// Runs at 3:59 PM PST (23:59 UTC) daily
// =====================================================

async function fetchAllExchangeHoldings() {
    console.log('📊 Fetching all exchange holdings...');

    const exchangeData = {};
    let grandTotal = 0;

    for (const [exchangeName, wallets] of Object.entries(EXCHANGE_WALLETS)) {
        let exchangeTotal = 0;
        let successCount = 0;

        for (const [address, walletName] of Object.entries(wallets)) {
            try {
                const balance = await fetchXRPLBalance(address);
                if (balance !== null) {
                    exchangeTotal += balance;
                    successCount++;
                }
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.log(`Failed to fetch ${walletName}: ${error.message}`);
            }
        }

        exchangeData[exchangeName] = {
            total: exchangeTotal,
            walletCount: Object.keys(wallets).length,
            successCount: successCount
        };
        grandTotal += exchangeTotal;

        console.log(`  ${exchangeName}: ${(exchangeTotal / 1e9).toFixed(2)}B XRP`);
    }

    return { exchanges: exchangeData, total: grandTotal, timestamp: Date.now() };
}

function formatDateKey(date = new Date()) {
    // Format as YYYY-MM-DD in PST
    const pst = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    return pst.toISOString().split('T')[0];
}

async function takeDailySnapshot() {
    console.log('📸 Taking daily exchange holdings snapshot...');

    try {
        const holdings = await fetchAllExchangeHoldings();
        const today = formatDateKey();

        // Check if we already have today's snapshot
        const existingIndex = dailyHoldingsTrend.findIndex(d => d.date === today);

        const entry = {
            date: today,
            total: holdings.total,
            exchanges: {},
            timestamp: Date.now(),
            isPastCutoff: true
        };

        // Store exchange totals
        for (const [name, data] of Object.entries(holdings.exchanges)) {
            entry.exchanges[name] = data.total;
        }

        if (existingIndex >= 0) {
            dailyHoldingsTrend[existingIndex] = entry;
            console.log(`✅ Updated snapshot for ${today}`);
        } else {
            dailyHoldingsTrend.push(entry);
            dailyHoldingsTrend.sort((a, b) => a.date.localeCompare(b.date));
            console.log(`✅ Added new snapshot for ${today}`);
        }

        // Keep only last 90 days
        if (dailyHoldingsTrend.length > 90) {
            dailyHoldingsTrend = dailyHoldingsTrend.slice(-90);
        }

        // Update cache
        exchangeHoldingsCache = { data: holdings, timestamp: Date.now() };

        console.log(`📊 Total exchange holdings: ${(holdings.total / 1e9).toFixed(2)}B XRP`);
        console.log(`📅 Trend data now has ${dailyHoldingsTrend.length} days`);

        return entry;

    } catch (error) {
        console.error('❌ Daily snapshot failed:', error.message);
        return null;
    }
}

// Schedule daily snapshot at 3:59 PM PST (23:59 UTC)
function scheduleDailySnapshot() {
    const now = new Date();

    // Target: 23:59 UTC (3:59 PM PST)
    const targetHour = 23;
    const targetMinute = 59;

    let target = new Date(now);
    target.setUTCHours(targetHour, targetMinute, 0, 0);

    // If we've passed today's target, schedule for tomorrow
    if (now >= target) {
        target.setUTCDate(target.getUTCDate() + 1);
    }

    const msUntilTarget = target.getTime() - now.getTime();
    const hoursUntil = (msUntilTarget / (1000 * 60 * 60)).toFixed(1);

    console.log(`⏰ Daily snapshot scheduled in ${hoursUntil} hours (3:59 PM PST / 23:59 UTC)`);

    setTimeout(async () => {
        await takeDailySnapshot();
        // Schedule next day
        scheduleDailySnapshot();
    }, msUntilTarget);
}

// API endpoint to get daily holdings trend
app.get('/api/exchange/holdings', async (req, res) => {
    const forceRefresh = req.query.refresh === 'true';

    // Return cached data if fresh
    if (!forceRefresh && exchangeHoldingsCache.data &&
        Date.now() - exchangeHoldingsCache.timestamp < EXCHANGE_CACHE_DURATION) {
        return res.json({
            ...exchangeHoldingsCache.data,
            cached: true,
            cacheAge: Date.now() - exchangeHoldingsCache.timestamp
        });
    }

    try {
        const holdings = await fetchAllExchangeHoldings();
        exchangeHoldingsCache = { data: holdings, timestamp: Date.now() };
        res.json({ ...holdings, cached: false });
    } catch (error) {
        console.error('Exchange holdings error:', error);
        if (exchangeHoldingsCache.data) {
            return res.json({ ...exchangeHoldingsCache.data, cached: true, stale: true });
        }
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to get daily trend data
app.get('/api/exchange/trend', (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const trendData = dailyHoldingsTrend.slice(-days);

    // Calculate changes
    const dataWithChanges = trendData.map((entry, index) => {
        const prev = index > 0 ? trendData[index - 1] : null;
        return {
            ...entry,
            change: prev ? entry.total - prev.total : 0,
            changePercent: prev ? ((entry.total - prev.total) / prev.total * 100).toFixed(2) : 0
        };
    });

    res.json({
        trend: dataWithChanges,
        count: dailyHoldingsTrend.length,
        latest: dailyHoldingsTrend[dailyHoldingsTrend.length - 1] || null
    });
});

// API endpoint to manually trigger snapshot (for testing)
app.post('/api/exchange/snapshot', async (req, res) => {
    console.log('📸 Manual snapshot triggered via API');
    const result = await takeDailySnapshot();
    if (result) {
        res.json({ success: true, snapshot: result });
    } else {
        res.status(500).json({ success: false, error: 'Snapshot failed' });
    }
});

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

        // Add timeout using AbortController
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

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
        if (error.name === 'AbortError') {
            console.error(`Timeout fetching ${symbol}`);
        } else {
            console.error(`Error fetching ${symbol}:`, error.message);
        }
        return null;
    }
}

async function fetchAllETFData() {
    console.log('Fetching all ETF data...');
    const results = {};

    for (const [groupName, symbols] of Object.entries(ETF_SYMBOLS)) {
        // Fetch all symbols in this group in parallel
        const promises = symbols.map(symbol => fetchYahooFinanceData(symbol));
        const groupResults = await Promise.all(promises);

        // Filter out null results
        const groupData = groupResults.filter(data => data !== null);

        if (groupData.length > 0) {
            results[groupName] = groupData;
            console.log(`${groupName}: ${groupData.length}/${symbols.length} loaded`);
        }
    }

    console.log('ETF data fetch complete');
    return results;
}

// =====================================================
// FETCH XRP PRICE
// =====================================================

async function fetchXRPPrice() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd&include_24hr_change=true&include_7d_change=true');
        const data = await response.json();
        return {
            price: data.ripple?.usd || 0,
            change24h: data.ripple?.usd_24h_change || 0
        };
    } catch (error) {
        console.error('XRP price fetch error:', error.message);
        return { price: 0, change24h: 0 };
    }
}

// =====================================================
// EMAIL SUMMARY GENERATOR - Using Rich List Data
// =====================================================

async function generateWeeklyEmailSummary() {
    try {
        // Fetch current XRP price
        const priceData = await fetchXRPPrice();
        const currentPrice = priceData.price || 0;
        const change24h = priceData.change24h || 0;

        // Fetch rich list (use force refresh to get fresh data)
        const richRes = await fetch('http://localhost:' + PORT + '/api/richlist?refresh=true');
        const richData = await richRes.json();

        if (!richData.accounts || !richData.stats) {
            throw new Error('Rich list data unavailable');
        }

        const { accounts, stats } = richData;

        // Summarize key holders (top 10 as example)
        const topHoldersSummary = accounts.slice(0, 10).map(a =>
            `- ${a.name} (${a.status}): ${a.balance.toLocaleString()} XRP (${a.percentage}%)`
        ).join('\n');

        // Key stats
        const whaleCount = stats.whale_accounts;
        const top10Dominance = stats.top10_dominance;
        const totalInSlice = stats.total_xrp.toLocaleString();

        // Build plain text email body
        const summary = `
Weekly XRP Snapshot (${new Date().toLocaleDateString()})

Current Price: $$  {currentPrice.toFixed(4)} (  $$ {change24h >= 0 ? '+' : ''} $${change24h.toFixed(2)}% 24h)

Rich List Highlights (XRPSCAN top ~${accounts.length} accounts):
- Total XRP in slice: ${totalInSlice} XRP
- Whales (≥1M XRP): ${whaleCount}
- Top 10 dominance: ${top10Dominance}%

Top 10 Holders:
${topHoldersSummary}

Note: Data from XRPSCAN rich list slice. Full top 10K not available via this source.
Full dashboard: https://xrp-1-0jnc.onrender.com

Stay informed — XRP Army 🚀
`;

        return summary;

    } catch (err) {
        console.error('Email summary generation failed:', err.message);
        return `Weekly XRP Report failed to generate: ${err.message}`;
    }
}


async function fetchWalletBalance(address) {
    try {
        const response = await fetch('https://s1.ripple.com:51234/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method: 'account_info',
                params: [{ account: address, ledger_index: 'validated' }]
            })
        });
        const data = await response.json();
        if (data.result?.account_data?.Balance) {
            return parseInt(data.result.account_data.Balance) / 1000000;
        }
        return 0;
    } catch (error) {
        console.error(`Balance fetch error for ${address}:`, error.message);
        return 0;
    }
}

async function fetchExchangeHoldings() {
    console.log('Fetching exchange holdings from XRPL...');
    const holdings = {};
    let total = 0;

    for (const [exchange, addresses] of Object.entries(EXCHANGE_WALLETS)) {
        let exchangeTotal = 0;
        for (const addr of addresses) {
            const balance = await fetchWalletBalance(addr);
            exchangeTotal += balance;
        }
        holdings[exchange] = exchangeTotal;
        total += exchangeTotal;
        console.log(`  ${exchange}: ${formatLargeNumber(exchangeTotal)} XRP`);
    }

    console.log(`Total exchange holdings: ${formatLargeNumber(total)} XRP`);
    return { holdings, total };
}

async function generateXPostSummary() {
    try {
        console.log('Generating X post with real data...');

        // Fetch real XRP price from CoinGecko
        const xrpData = await fetchXRPPrice();
        console.log(`XRP Price: $${xrpData.price}, Change: ${xrpData.change24h}%`);

        // Fetch real exchange holdings from XRPL
        const exchangeData = await fetchExchangeHoldings();

        // Sort exchanges by holdings
        const sortedExchanges = Object.entries(exchangeData.holdings)
            .filter(([_, bal]) => bal > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        // Also get XRP Spot ETF data
        const etfData = await fetchAllETFData();
        const xrpETFs = etfData['Spot ETFs'] || [];
        let etfTotalVolume = 0;
        xrpETFs.forEach(etf => {
            etfTotalVolume += etf.daily?.dollars || 0;
        });

        // Format the X post
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
        const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' });

        const priceChange = xrpData.change24h >= 0 ? `+${xrpData.change24h.toFixed(2)}%` : `${xrpData.change24h.toFixed(2)}%`;

        // Build exchange holdings text
        let exchangeText = sortedExchanges.map(([name, bal]) =>
            `• ${name}: ${formatLargeNumber(bal)}`
        ).join('\n');

        // Build the X post
        let xPost = `📊 XRP Update - ${dateStr} ${timeStr} PST

💰 $XRP: $${xrpData.price.toFixed(4)} (${priceChange})

🏦 Exchange Holdings:
${exchangeText}

📈 Total: ${formatLargeNumber(exchangeData.total)} XRP`;

        // Add ETF volume if available
        if (etfTotalVolume > 0) {
            xPost += `\n💎 ETF Vol: $${formatLargeNumber(etfTotalVolume)}`;
        }

        xPost += `\n\n#XRP #Crypto #Ripple`;

        // If too long, shorten
        if (xPost.length > 280) {
            xPost = `📊 XRP - ${dateStr}

💰 $${xrpData.price.toFixed(2)} (${priceChange})
🏦 Exchanges: ${formatLargeNumber(exchangeData.total)} XRP

Top: ${sortedExchanges.slice(0, 3).map(e => e[0]).join(', ')}

#XRP #Crypto`;
        }

        const charCount = xPost.length;

        return {
            post: xPost,
            charCount,
            isValid: charCount <= 280,
            data: {
                price: xrpData.price,
                change: xrpData.change24h,
                exchangeTotal: exchangeData.total,
                exchanges: exchangeData.holdings,
                etfVolume: etfTotalVolume
            }
        };
    } catch (error) {
        console.error('Error generating X post:', error);
        return null;
    }
}

// =====================================================
// SEND EMAIL VIA RESEND
// =====================================================

async function sendEmail(to, subject, htmlContent, textContent) {
    if (!RESEND_API_KEY) {
        console.log('⚠️ Email not sent - No API key');
        return false;
    }

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: EMAIL_FROM,
                to: [to],
                subject: subject,
                html: htmlContent,
                text: textContent
            })
        });

        const result = await response.json();

        if (response.ok) {
            console.log(`✅ Email sent to ${to}: ${subject}`);
            return true;
        } else {
            console.error('❌ Email error:', result);
            return false;
        }
    } catch (error) {
        console.error('❌ Email send failed:', error.message);
        return false;
    }
}

async function sendXPostEmail() {
    const summary = await generateXPostSummary();
    if (!summary) {
        console.error('Failed to generate summary');
        return false;
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Los_Angeles'
    });
    const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'America/Los_Angeles'
    });

    const subject = `📊 XRP Update - Ready to Post (${dateStr} ${timeStr} PST)`;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
        .container { max-width: 500px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 20px; }
        .header h1 { color: #23f7dd; margin: 0; }
        .post-box { background: #1e293b; border: 2px solid #23f7dd; border-radius: 12px; padding: 20px; margin: 20px 0; }
        .post-content { white-space: pre-wrap; font-size: 15px; line-height: 1.5; color: #f8fafc; }
        .char-count { text-align: right; font-size: 12px; color: ${summary.isValid ? '#22c55e' : '#ef4444'}; margin-top: 10px; }
        .divider { border-top: 1px solid #334155; margin: 20px 0; }
        .footer { text-align: center; color: #64748b; font-size: 12px; }
        .btn { display: inline-block; background: #23f7dd; color: #0f172a; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 10px 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🐦 Ready to Post on X</h1>
            <p style="color: #94a3b8;">${dateStr} • ${timeStr} PST</p>
        </div>
        
        <p style="text-align: center; color: #23f7dd;">👇 COPY & POST 👇</p>
        
        <div class="post-box">
            <div class="post-content">${summary.post}</div>
            <div class="char-count">${summary.charCount}/280 characters ${summary.isValid ? '✅' : '⚠️'}</div>
        </div>
        
        <div style="text-align: center;">
            <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(summary.post)}" class="btn">Post to X →</a>
        </div>
        
        <div class="divider"></div>
        
        <div class="footer">
            <p>XRP ETF Tracker • Automated Update</p>
            <p>View live data: <a href="https://xrp-etf.vercel.app" style="color: #23f7dd;">xrp-etf.vercel.app</a></p>
        </div>
    </div>
</body>
</html>
`;

    const textContent = `
XRP UPDATE - READY TO POST
${dateStr} ${timeStr} PST
━━━━━━━━━━━━━━━━━━━━

COPY & POST TO X 👇

${summary.post}

━━━━━━━━━━━━━━━━━━━━
Characters: ${summary.charCount}/280 ${summary.isValid ? '✅' : '⚠️'}

Post directly: https://twitter.com/intent/tweet?text=${encodeURIComponent(summary.post)}
`;

    return await sendEmail(EMAIL_RECIPIENT, subject, htmlContent, textContent);
}

// =====================================================
// SCHEDULED EMAIL JOBS
// =====================================================

function scheduleEmails() {
    if (!emailEnabled) {
        console.log('⚠️ Email scheduling skipped - not enabled');
        return;
    }

    // Check every minute if it's time to send
    setInterval(async () => {
        const now = new Date();
        const utcHour = now.getUTCHours();
        const utcMinute = now.getUTCMinutes();

        // Only send at the start of the hour (minute 0-1)
        if (utcMinute > 1) return;

        if (SCHEDULE_HOURS_UTC.includes(utcHour)) {
            console.log(`⏰ Scheduled email time: ${utcHour}:00 UTC`);
            await sendXPostEmail();
        }
    }, 60000); // Check every minute

    console.log('📅 Email scheduler started');
    console.log(`   Schedule (UTC): ${SCHEDULE_HOURS_UTC.map(h => h + ':00').join(', ')}`);
    console.log(`   Schedule (PST): 8:00 AM, 1:00 PM, 4:00 PM`);
}

// =====================================================
// API ENDPOINTS
// =====================================================

// =====================================================
// COINGECKO SOCIAL/COMMUNITY ENDPOINTS (FREE)
// =====================================================

// Get XRP community/social data from CoinGecko
app.get('/api/xrp/topic', async (req, res) => {
    const cacheKey = 'xrp_community';
    const cached = getCoinGeckoCached(cacheKey);
    if (cached) {
        return res.json({ data: cached, cached: true });
    }
    
    // CoinGecko provides community data in the coin endpoint
    const result = await coingeckoRequest('/coins/ripple?localization=false&tickers=false&market_data=true&community_data=true&developer_data=true');
    if (result) {
        const data = {
            topic: 'xrp',
            title: 'XRP',
            sentiment: result.sentiment_votes_up_percentage || 50,
            sentiment_up: result.sentiment_votes_up_percentage || 50,
            sentiment_down: result.sentiment_votes_down_percentage || 50,
            twitter_followers: result.community_data?.twitter_followers || 0,
            reddit_subscribers: result.community_data?.reddit_subscribers || 0,
            reddit_active_accounts: result.community_data?.reddit_accounts_active_48h || 0,
            telegram_users: result.community_data?.telegram_channel_user_count || 0,
            github_forks: result.developer_data?.forks || 0,
            github_stars: result.developer_data?.stars || 0,
            github_subscribers: result.developer_data?.subscribers || 0,
            github_total_issues: result.developer_data?.total_issues || 0,
            github_commits_4_weeks: result.developer_data?.commit_count_4_weeks || 0,
            price: result.market_data?.current_price?.usd || 0,
            price_change_24h: result.market_data?.price_change_percentage_24h || 0,
            market_cap: result.market_data?.market_cap?.usd || 0,
            volume_24h: result.market_data?.total_volume?.usd || 0,
            market_cap_rank: result.market_cap_rank || 0
        };
        setCoinGeckoCache(cacheKey, data);
        return res.json({ data, cached: false });
    }
    
    res.status(500).json({ error: 'Failed to fetch community data' });
});

// Get XRP market chart for trend data
app.get('/api/xrp/timeseries', async (req, res) => {
    const days = req.query.days || '7';
    const cacheKey = `xrp_chart_${days}`;
    
    const cached = getCoinGeckoCached(cacheKey);
    if (cached) {
        return res.json({ data: cached, cached: true });
    }
    
    const result = await coingeckoRequest(`/coins/ripple/market_chart?vs_currency=usd&days=${days}`);
    if (result) {
        // Transform to timeseries format
        const data = result.prices?.map((p, i) => ({
            time: Math.floor(p[0] / 1000),
            price: p[1],
            volume: result.total_volumes?.[i]?.[1] || 0,
            market_cap: result.market_caps?.[i]?.[1] || 0
        })) || [];
        setCoinGeckoCache(cacheKey, data);
        return res.json({ data, cached: false });
    }
    
    res.status(500).json({ error: 'Failed to fetch timeseries' });
});

// Get XRP coin market data
app.get('/api/xrp/coin', async (req, res) => {
    const cacheKey = 'xrp_coin';
    const cached = getCoinGeckoCached(cacheKey);
    if (cached) {
        return res.json({ data: cached, cached: true });
    }
    
    const result = await coingeckoRequest('/coins/ripple?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false');
    if (result) {
        const data = {
            id: result.id,
            symbol: result.symbol?.toUpperCase(),
            name: result.name,
            price: result.market_data?.current_price?.usd,
            price_btc: result.market_data?.current_price?.btc,
            market_cap: result.market_data?.market_cap?.usd,
            market_cap_rank: result.market_cap_rank,
            volume_24h: result.market_data?.total_volume?.usd,
            percent_change_24h: result.market_data?.price_change_percentage_24h,
            percent_change_7d: result.market_data?.price_change_percentage_7d,
            percent_change_30d: result.market_data?.price_change_percentage_30d,
            circulating_supply: result.market_data?.circulating_supply,
            max_supply: result.market_data?.max_supply,
            ath: result.market_data?.ath?.usd,
            ath_date: result.market_data?.ath_date?.usd,
            atl: result.market_data?.atl?.usd,
            atl_date: result.market_data?.atl_date?.usd
        };
        setCoinGeckoCache(cacheKey, data);
        return res.json({ data, cached: false });
    }
    
    res.status(500).json({ error: 'Failed to fetch coin data' });
});

// Get ALL XRP data in one request (combined endpoint)
app.get('/api/xrp/all', async (req, res) => {
    const forceRefresh = req.query.refresh === 'true';
    const cacheKey = 'xrp_all';
    
    if (forceRefresh) {
        clearCoinGeckoCache();
        console.log('Force refresh requested - cache cleared');
    }
    
    const cached = getCoinGeckoCached(cacheKey, forceRefresh);
    if (cached) {
        return res.json({ data: cached, cached: true });
    }
    
    console.log('Fetching fresh data from CoinGecko (FREE)...');
    
    // Use SINGLE API call to get all data (to avoid rate limits)
    const coinData = await coingeckoRequest('/coins/ripple?localization=false&tickers=false&market_data=true&community_data=true&developer_data=true&sparkline=true');
    
    if (!coinData) {
        console.log('CoinGecko request failed - returning error');
        return res.status(503).json({ 
            error: 'CoinGecko API unavailable (rate limited)', 
            message: 'Please wait a minute and try again',
            cached: false 
        });
    }
    
    console.log('CoinGecko data received successfully');
    
    // Calculate social engagement score based on available metrics
    const twitterFollowers = coinData?.community_data?.twitter_followers || 0;
    const redditSubs = coinData?.community_data?.reddit_subscribers || 0;
    const redditActive = coinData?.community_data?.reddit_accounts_active_48h || 0;
    const sentimentUp = coinData?.sentiment_votes_up_percentage || 50;
    
    // Synthesized social score (0-100)
    const socialScore = Math.min(100, Math.round(
        (sentimentUp * 0.4) + 
        (Math.min(redditActive / 100, 30)) + 
        (Math.min(twitterFollowers / 100000, 30))
    ));
    
    // Use sparkline data for timeseries (last 7 days)
    const sparkline = coinData?.market_data?.sparkline_7d?.price || [];
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    
    const data = {
        topic: {
            topic: 'xrp',
            title: 'XRP (Ripple)',
            sentiment: socialScore,
            sentiment_up: sentimentUp,
            sentiment_down: coinData?.sentiment_votes_down_percentage || 50,
            interactions_24h: redditActive * 100, // Estimated engagement
            num_contributors: redditActive,
            num_posts: Math.round(redditActive * 2.5), // Estimated posts
            twitter_followers: twitterFollowers,
            reddit_subscribers: redditSubs,
            reddit_active: redditActive,
            trend: coinData?.market_data?.price_change_percentage_24h > 0 ? 'up' : 'down'
        },
        coin: {
            id: coinData?.id,
            symbol: coinData?.symbol?.toUpperCase(),
            name: coinData?.name,
            price: coinData?.market_data?.current_price?.usd,
            market_cap: coinData?.market_data?.market_cap?.usd,
            market_cap_rank: coinData?.market_cap_rank,
            volume_24h: coinData?.market_data?.total_volume?.usd,
            percent_change_24h: coinData?.market_data?.price_change_percentage_24h,
            percent_change_7d: coinData?.market_data?.price_change_percentage_7d
        },
        timeseries: sparkline.map((price, i) => ({
            time: Math.floor((now - (sparkline.length - i) * hourMs) / 1000),
            price: price,
            sentiment: socialScore + (Math.random() - 0.5) * 10 // Simulated variance
        })),
        posts: [], // CoinGecko doesn't provide social posts
        news: [], // CoinGecko doesn't provide news
        developer: {
            forks: coinData?.developer_data?.forks || 0,
            stars: coinData?.developer_data?.stars || 0,
            commits_4_weeks: coinData?.developer_data?.commit_count_4_weeks || 0,
            total_issues: coinData?.developer_data?.total_issues || 0
        },
        timestamp: new Date().toISOString(),
        source: 'coingecko_free'
    };
    
    // Cache the data
    setCoinGeckoCache(cacheKey, data);
    
    res.json({ data, cached: false });
});

// Clear cache endpoint
app.get('/api/xrp/clear-cache', (req, res) => {
    clearCoinGeckoCache();
    res.json({ success: true, message: 'CoinGecko cache cleared' });
});

// ETF Data endpoint
app.get('/api/etf-data', async (req, res) => {
    try {
        if (etfDataCache.data && etfDataCache.timestamp &&
            Date.now() - etfDataCache.timestamp < ETF_CACHE_DURATION) {
            return res.json({
                timestamp: new Date(etfDataCache.timestamp).toISOString(),
                cached: true,
                data: etfDataCache.data
            });
        }

        const data = await fetchAllETFData();
        etfDataCache = { data, timestamp: Date.now() };

        res.json({
            timestamp: new Date().toISOString(),
            cached: false,
            data
        });
    } catch (error) {
        console.error('ETF data error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Historical data endpoint
app.get('/api/historical', async (req, res) => {
    const period = req.query.period || '1mo';
    console.log(`[Historical] Fetching data for period: ${period}`);

    // Map period to Yahoo Finance parameters
    const periodMap = {
        '1mo': { range: '1mo', interval: '1d' },
        '3mo': { range: '3mo', interval: '1d' },
        '6mo': { range: '6mo', interval: '1d' },
        '1y': { range: '1y', interval: '1wk' }
    };

    const { range, interval } = periodMap[period] || periodMap['1mo'];

    // XRP ETFs only
    const symbols = ['GXRP', 'XRP', 'XRPC', 'XXRP'];

    try {
        const historicalData = {};

        for (const symbol of symbols) {
            try {
                console.log(`[Historical] Fetching ${symbol}...`);
                const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                console.log(`[Historical] ${symbol} response status: ${response.status}`);

                if (!response.ok) {
                    console.log(`[Historical] ${symbol} failed with status ${response.status}`);
                    continue;
                }

                const data = await response.json();
                const result = data.chart?.result?.[0];

                if (!result || !result.timestamp) {
                    console.log(`[Historical] ${symbol} no timestamp data`);
                    continue;
                }

                const timestamps = result.timestamp;
                const quotes = result.indicators?.quote?.[0];

                if (!quotes) {
                    console.log(`[Historical] ${symbol} no quotes data`);
                    continue;
                }

                const chartData = [];
                for (let i = 0; i < timestamps.length; i++) {
                    const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
                    const close = quotes.close?.[i];
                    const volume = quotes.volume?.[i];

                    if (close != null) {
                        chartData.push({
                            date,
                            price: parseFloat(close.toFixed(4)),
                            volume: volume || 0
                        });
                    }
                }

                if (chartData.length > 0) {
                    historicalData[symbol] = chartData;
                    console.log(`[Historical] ${symbol} got ${chartData.length} data points`);
                }
            } catch (err) {
                console.log(`[Historical] Failed to fetch ${symbol}:`, err.message);
            }
        }

        // If no data fetched, return generated sample data so chart works
        if (Object.keys(historicalData).length === 0) {
            console.log('[Historical] No data from Yahoo, generating sample data');
            const today = new Date();
            const sampleSymbols = ['GXRP', 'XRP', 'XXRP'];
            const basePrices = { 'GXRP': 40, 'XRP': 23, 'XXRP': 12 };

            for (const symbol of sampleSymbols) {
                const chartData = [];
                const basePrice = basePrices[symbol];

                for (let i = 30; i >= 0; i--) {
                    const date = new Date(today);
                    date.setDate(date.getDate() - i);
                    const dateStr = date.toISOString().split('T')[0];
                    // Add some random variation
                    const variation = (Math.random() - 0.5) * 4;
                    chartData.push({
                        date: dateStr,
                        price: parseFloat((basePrice + variation).toFixed(4)),
                        volume: Math.floor(Math.random() * 500000) + 100000
                    });
                }
                historicalData[symbol] = chartData;
            }
        }

        console.log(`[Historical] Returning data for symbols: ${Object.keys(historicalData).join(', ')}`);

        res.json({
            period,
            data: historicalData,
            symbols: Object.keys(historicalData)
        });
    } catch (error) {
        console.error('[Historical] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// AI Insights endpoint
app.post('/api/ai-insights', async (req, res) => {
    if (!anthropic) {
        return res.status(503).json({ error: 'AI not configured' });
    }

    const ip = req.ip || req.connection.remoteAddress;
    if (isRateLimited(ip)) {
        return res.status(429).json({ error: 'Rate limited. Try again in a minute.' });
    }

    try {
        const now = Date.now();
        const forceRefresh = req.body.forceRefresh === true;

        // Check cache (skip if force refresh)
        if (!forceRefresh && insightCache.data && now - insightCache.timestamp < AI_CACHE_DURATION) {
            return res.json({ ...insightCache.data, cached: true, success: true });
        }

        const marketData = req.body.marketData || req.body || {};
        const prompt = buildInsightPrompt(marketData);

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }]
        });

        const insight = response.content[0]?.text || 'Unable to generate insights.';
        const result = {
            success: true,
            analysis: insight,
            insight,
            timestamp: new Date().toISOString(),
            sentiment: marketData.sentimentScore || 50
        };

        insightCache = { data: result, timestamp: now };
        res.json(result);
    } catch (error) {
        console.error('AI error:', error);
        res.status(500).json({ error: 'AI generation failed', success: false });
    }
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    if (!anthropic) {
        return res.status(503).json({ error: 'AI not configured' });
    }

    const ip = req.ip || req.connection.remoteAddress;
    if (isRateLimited(ip)) {
        return res.status(429).json({ error: 'Rate limited' });
    }

    try {
        const { message, context } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        const relevantDocs = findRelevantDocs(message);
        let systemPrompt = `You are an XRP and crypto ETF expert assistant. Be concise and helpful.`;

        if (relevantDocs.length > 0) {
            systemPrompt += `\n\nRelevant information:\n${relevantDocs.map(d => `- ${d.title}: ${d.content}`).join('\n')}`;
        }

        if (context) {
            systemPrompt += `\n\nCurrent market context: XRP price $${context.xrpPrice || 'N/A'}, ETF holdings: ${context.etfHoldings || 'N/A'}`;
        }

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 512,
            system: systemPrompt,
            messages: [{ role: 'user', content: message }]
        });

        res.json({
            response: response.content[0]?.text || 'Unable to respond.',
            sources: relevantDocs.map(d => d.title)
        });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'Chat failed' });
    }
});

// =====================================================
// EMAIL API ENDPOINTS
// =====================================================

// Generate X post summary (preview)
app.get('/api/x-post', async (req, res) => {
    try {
        const summary = await generateXPostSummary();
        if (summary) {
            res.json(summary);
        } else {
            res.status(500).json({ error: 'Failed to generate summary' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manually trigger email (for testing)
app.post('/api/send-email', async (req, res) => {
    const { secret } = req.body;

    // Simple protection - require a secret to send manually
    if (secret !== process.env.EMAIL_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const success = await sendXPostEmail();
        res.json({ success, message: success ? 'Email sent!' : 'Failed to send email' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Email status
app.get('/api/email-status', (req, res) => {
    res.json({
        enabled: emailEnabled,
        recipient: EMAIL_RECIPIENT,
        schedule: {
            times: ['8:00 AM PST', '1:00 PM PST', '4:00 PM PST'],
            utcHours: SCHEDULE_HOURS_UTC
        }
    });
});

// =====================================================
// ON-CHAIN ENDPOINTS
// =====================================================

// Escrow data
app.get('/api/onchain/escrow', async (req, res) => {
    try {
        if (onChainCache.escrow && onChainCache.lastUpdate &&
            Date.now() - onChainCache.lastUpdate < ONCHAIN_CACHE_DURATION) {
            return res.json({ success: true, data: onChainCache.escrow, cached: true });
        }

        const escrowAccount = 'rrrrrrrrrrrrrrrrrrrrrhoLvTp';
        const response = await fetch('https://s1.ripple.com:51234/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method: 'account_info',
                params: [{ account: escrowAccount, ledger_index: 'validated' }]
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
        emailEnabled: emailEnabled,
        hasApiKey: !!process.env.ANTHROPIC_API_KEY
    });
});

// =====================================================
// SENTIMENT METER - Live Market Sentiment Analysis
// =====================================================

// Cache for sentiment data
let sentimentCache = { data: null, timestamp: 0 };
const SENTIMENT_CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

// Reuse EXCHANGE_WALLETS from email section (already defined above)

async function fetchXRPMarketData() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/coins/ripple?localization=false&tickers=false&community_data=false&developer_data=false');
        const data = await response.json();
        return {
            price: data.market_data?.current_price?.usd || 0,
            change24h: data.market_data?.price_change_percentage_24h || 0,
            change7d: data.market_data?.price_change_percentage_7d || 0,
            change30d: data.market_data?.price_change_percentage_30d || 0,
            volume24h: data.market_data?.total_volume?.usd || 0,
            marketCap: data.market_data?.market_cap?.usd || 0
        };
    } catch (error) {
        console.error('Market data fetch error:', error.message);
        return null;
    }
}

async function fetchSentimentExchangeBalance(address) {
    try {
        const response = await fetch('https://s1.ripple.com:51234/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method: 'account_info',
                params: [{ account: address, ledger_index: 'validated' }]
            })
        });
        const data = await response.json();
        if (data.result?.account_data?.Balance) {
            return parseInt(data.result.account_data.Balance) / 1000000;
        }
        return 0;
    } catch (error) {
        return 0;
    }
}

async function calculateSentiment() {
    try {
        console.log('Calculating sentiment...');

        // Fetch market data
        const marketData = await fetchXRPMarketData();
        if (!marketData) {
            return { score: 50, label: 'Neutral', signals: ['Unable to fetch market data'] };
        }

        // Fetch ETF data
        const etfData = await fetchAllETFData();

        // Fetch exchange balances
        let totalExchangeBalance = 0;
        const exchangeBalances = {};
        for (const [name, address] of Object.entries(EXCHANGE_WALLETS)) {
            const balance = await fetchSentimentExchangeBalance(address);
            exchangeBalances[name] = balance;
            totalExchangeBalance += balance;
        }

        // Calculate sentiment signals
        const signals = [];
        let score = 50; // Start neutral

        // 1. Price Momentum (24h) - Weight: 20 points
        if (marketData.change24h > 5) {
            score += 15;
            signals.push({ factor: '24h Price', impact: 'bullish', detail: `+${marketData.change24h.toFixed(2)}% (Strong momentum)` });
        } else if (marketData.change24h > 2) {
            score += 10;
            signals.push({ factor: '24h Price', impact: 'bullish', detail: `+${marketData.change24h.toFixed(2)}% (Positive)` });
        } else if (marketData.change24h > 0) {
            score += 5;
            signals.push({ factor: '24h Price', impact: 'slightly_bullish', detail: `+${marketData.change24h.toFixed(2)}%` });
        } else if (marketData.change24h > -2) {
            score -= 5;
            signals.push({ factor: '24h Price', impact: 'slightly_bearish', detail: `${marketData.change24h.toFixed(2)}%` });
        } else if (marketData.change24h > -5) {
            score -= 10;
            signals.push({ factor: '24h Price', impact: 'bearish', detail: `${marketData.change24h.toFixed(2)}% (Negative)` });
        } else {
            score -= 15;
            signals.push({ factor: '24h Price', impact: 'bearish', detail: `${marketData.change24h.toFixed(2)}% (Strong decline)` });
        }

        // 2. Weekly Trend (7d) - Weight: 15 points
        if (marketData.change7d > 10) {
            score += 12;
            signals.push({ factor: '7d Trend', impact: 'bullish', detail: `+${marketData.change7d.toFixed(2)}% (Strong uptrend)` });
        } else if (marketData.change7d > 0) {
            score += 6;
            signals.push({ factor: '7d Trend', impact: 'slightly_bullish', detail: `+${marketData.change7d.toFixed(2)}%` });
        } else if (marketData.change7d > -10) {
            score -= 6;
            signals.push({ factor: '7d Trend', impact: 'slightly_bearish', detail: `${marketData.change7d.toFixed(2)}%` });
        } else {
            score -= 12;
            signals.push({ factor: '7d Trend', impact: 'bearish', detail: `${marketData.change7d.toFixed(2)}% (Downtrend)` });
        }

        // 3. Monthly Trend (30d) - Weight: 10 points
        if (marketData.change30d > 20) {
            score += 8;
            signals.push({ factor: '30d Trend', impact: 'bullish', detail: `+${marketData.change30d.toFixed(2)}% (Strong rally)` });
        } else if (marketData.change30d > 0) {
            score += 4;
            signals.push({ factor: '30d Trend', impact: 'slightly_bullish', detail: `+${marketData.change30d.toFixed(2)}%` });
        } else {
            score -= 4;
            signals.push({ factor: '30d Trend', impact: 'slightly_bearish', detail: `${marketData.change30d.toFixed(2)}%` });
        }

        // 4. ETF Volume Analysis - Weight: 15 points
        let totalETFVolume = 0;
        const spotETFs = etfData['Spot ETFs'] || [];
        spotETFs.forEach(etf => {
            totalETFVolume += etf.daily?.dollars || 0;
        });

        if (totalETFVolume > 50000000) { // > $50M
            score += 12;
            signals.push({ factor: 'ETF Volume', impact: 'bullish', detail: `$${formatLargeNumber(totalETFVolume)} (High institutional interest)` });
        } else if (totalETFVolume > 20000000) { // > $20M
            score += 6;
            signals.push({ factor: 'ETF Volume', impact: 'slightly_bullish', detail: `$${formatLargeNumber(totalETFVolume)} (Moderate activity)` });
        } else if (totalETFVolume > 5000000) { // > $5M
            score += 2;
            signals.push({ factor: 'ETF Volume', impact: 'neutral', detail: `$${formatLargeNumber(totalETFVolume)} (Normal activity)` });
        } else {
            score -= 3;
            signals.push({ factor: 'ETF Volume', impact: 'slightly_bearish', detail: `$${formatLargeNumber(totalETFVolume)} (Low activity)` });
        }

        // 5. Exchange Holdings Analysis - Weight: 10 points
        // Lower exchange holdings = bullish (coins moving to cold storage)
        // This is a simplified heuristic - in production you'd compare to historical data
        const exchangeHoldingsBillions = totalExchangeBalance / 1e9;
        if (exchangeHoldingsBillions < 10) {
            score += 8;
            signals.push({ factor: 'Exchange Holdings', impact: 'bullish', detail: `${exchangeHoldingsBillions.toFixed(2)}B XRP (Low - accumulation signal)` });
        } else if (exchangeHoldingsBillions < 15) {
            score += 3;
            signals.push({ factor: 'Exchange Holdings', impact: 'slightly_bullish', detail: `${exchangeHoldingsBillions.toFixed(2)}B XRP (Moderate)` });
        } else {
            score -= 3;
            signals.push({ factor: 'Exchange Holdings', impact: 'slightly_bearish', detail: `${exchangeHoldingsBillions.toFixed(2)}B XRP (High - potential sell pressure)` });
        }

        // Clamp score between 0 and 100
        score = Math.max(0, Math.min(100, score));

        // Determine label
        let label, color;
        if (score >= 70) {
            label = 'Bullish';
            color = '#22c55e'; // green
        } else if (score >= 55) {
            label = 'Slightly Bullish';
            color = '#84cc16'; // lime
        } else if (score >= 45) {
            label = 'Neutral';
            color = '#eab308'; // yellow
        } else if (score >= 30) {
            label = 'Slightly Bearish';
            color = '#f97316'; // orange
        } else {
            label = 'Bearish';
            color = '#ef4444'; // red
        }

        return {
            score: Math.round(score),
            label,
            color,
            signals,
            marketData: {
                price: marketData.price,
                change24h: marketData.change24h,
                change7d: marketData.change7d,
                change30d: marketData.change30d,
                volume24h: marketData.volume24h
            },
            etfVolume: totalETFVolume,
            exchangeHoldings: totalExchangeBalance,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error('Sentiment calculation error:', error);
        return { score: 50, label: 'Neutral', error: error.message };
    }
}

// Sentiment API Endpoint
app.get('/api/sentiment', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === 'true';

        // Check cache
        if (!forceRefresh && sentimentCache.data &&
            Date.now() - sentimentCache.timestamp < SENTIMENT_CACHE_DURATION) {
            return res.json({ ...sentimentCache.data, cached: true });
        }

        // Calculate fresh sentiment
        const sentiment = await calculateSentiment();

        // Update cache
        sentimentCache = { data: sentiment, timestamp: Date.now() };

        res.json({ ...sentiment, cached: false });
    } catch (error) {
        console.error('Sentiment API error:', error);
        res.status(500).json({ error: error.message });
    }
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

// ... (all your existing code above this point remains unchanged)

// Existing routes are here, e.g.:
// app.get('/api/etf-data', async (req, res) => { ... });
// app.get('/api/sentiment', async (req, res) => { ... });
// app.get('/api/richlist', ...)  ← old version if you have one

// ────────────────────────────────────────────────
// NEW / IMPROVED RICH LIST ENDPOINT
// Place it here, replacing any old /api/richlist if it exists
// ────────────────────────────────────────────────

let richListCache = { data: null, timestamp: 0 };
const RICHLIST_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes - adjust as needed

app.get('/api/richlist', async (req, res) => {
    const forceRefresh = req.query.refresh === 'true';

    if (!forceRefresh && richListCache.data && (Date.now() - richListCache.timestamp < RICHLIST_CACHE_DURATION)) {
        return res.json({ ...richListCache.data, cached: true });
    }

    try {
        console.log('Fetching rich list from XRPSCAN...');

        const response = await fetch('https://api.xrpscan.com/api/v1/balances', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`XRPSCAN returned ${response.status}`);
        }

        const data = await response.json();

        // Log raw first entry for debugging
        if (data.length > 0) {
            console.log('Raw first entry from XRPSCAN:', JSON.stringify(data[0]));
        }

        if (!Array.isArray(data)) {
            throw new Error('Invalid response: not an array');
        }

        // Process the returned data
        let accounts = data.map((acc) => {
            // XRPScan returns balance in DROPS (1 XRP = 1,000,000 drops)
            const rawBalance = Number(acc.balance);
            const balanceXRP = rawBalance / 1_000_000;

            let displayName = 'Unknown';
            let status = 'Whale';

            if (acc.name && acc.name.name) {
                displayName = acc.name.name;
                if (['Binance', 'Uphold', 'Bitso', 'Kraken', 'Bitstamp', 'Coinbase', 'Robinhood', 'Bithumb', 'Upbit', 'bitbank', 'Bitfinex', 'OKX', 'Huobi', 'KuCoin', 'Crypto.com', 'Gemini', 'Gate.io'].some(e => displayName.includes(e))) {
                    status = 'Exchange';
                } else if (displayName.includes('Ripple')) {
                    status = 'Ripple';
                }
            }

            return {
                address: acc.account,
                balance: balanceXRP,
                name: displayName,
                percentage: 0,
                status
            };
        });

        // Sort by balance descending (highest first)
        accounts.sort((a, b) => b.balance - a.balance);

        // Assign ranks after sorting
        accounts = accounts.map((acc, index) => ({
            ...acc,
            rank: index + 1
        }));

        // Log first processed account
        if (accounts.length > 0) {
            console.log('Processed first account (after sort):', accounts[0]);
        }

        // Compute percentages based on this slice's total
        const totalInSlice = accounts.reduce((sum, a) => sum + a.balance, 0);
        accounts.forEach(a => {
            a.percentage = ((a.balance / totalInSlice) * 100).toFixed(4);
        });

        // Stats
        const stats = {
            total_xrp: totalInSlice,
            count: accounts.length,
            whale_accounts: accounts.filter(a => a.balance >= 1_000_000).length,
            top10_dominance: accounts.slice(0, 10).reduce((sum, a) => sum + Number(a.percentage), 0).toFixed(2),
            mean_balance: totalInSlice / accounts.length,
            median_balance: accounts[Math.floor(accounts.length / 2)]?.balance || 0,
            fetched_at: new Date().toISOString(),
            source: 'xrpscan'
        };

        const result = { accounts, stats, source: 'xrpscan' };

        richListCache = { data: result, timestamp: Date.now() };
        res.json(result);

    } catch (error) {
        console.error('Rich list fetch failed:', error.message);

        // Return cached data if available (even if stale)
        if (richListCache.data) {
            console.log('Returning stale cached data');
            return res.json({ ...richListCache.data, cached: true, stale: true });
        }

        // Return error with empty structure so frontend doesn't break
        res.status(503).json({
            error: 'Rich list temporarily unavailable',
            accounts: [],
            stats: {
                total_xrp: 0,
                count: 0,
                whale_accounts: 0,
                top10_dominance: 0,
                fetched_at: new Date().toISOString(),
                source: 'error'
            }
        });
    }
});
// =====================================================
// START SERVER
// =====================================================

// Catch-all route to serve index.html for SPA/PWA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log('=========================================');
    console.log(`🚀 XRP ETF Tracker API running on port ${PORT}`);
    console.log('=========================================');
    console.log('Endpoints:');
    console.log('  GET  /api/etf-data');
    console.log('  GET  /api/historical');
    console.log('  POST /api/ai-insights');
    console.log('  POST /api/chat');
    console.log('  GET  /api/sentiment         (live sentiment meter)');
    console.log('  GET  /api/onchain/escrow');
    console.log('  GET  /api/onchain/network');
    console.log('  GET  /api/onchain/dex');
    console.log('  GET  /api/x-post          (preview X post)');
    console.log('  POST /api/send-email      (manual trigger)');
    console.log('  GET  /api/email-status    (check schedule)');
    console.log('  --- Exchange Holdings Trend ---');
    console.log('  GET  /api/exchange/holdings (current holdings)');
    console.log('  GET  /api/exchange/trend    (daily trend data)');
    console.log('  POST /api/exchange/snapshot (manual snapshot)');
    console.log('  --- CoinGecko Social/Community (FREE) ---');
    console.log('  GET  /api/xrp/all          (all social data)');
    console.log('  GET  /api/xrp/topic        (social metrics)');
    console.log('  GET  /api/xrp/posts        (top posts)');
    console.log('  GET  /api/xrp/timeseries   (historical)');
    console.log('  GET  /api/xrp/news         (news articles)');
    console.log('  GET  /api/xrp/coin         (market data)');
    console.log('=========================================');
    console.log(`AI: ${anthropic ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`Email: ${emailEnabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`CoinGecko: ✅ Enabled (FREE)`);
    console.log('=========================================');

    // Start email scheduler
    scheduleEmails();

    // Start daily holdings snapshot scheduler (3:59 PM PST)
    scheduleDailySnapshot();

    // Take initial snapshot on startup if we don't have today's data
    const today = formatDateKey();
    const hasToday = dailyHoldingsTrend.some(d => d.date === today);
    if (!hasToday) {
        console.log('📸 No snapshot for today, taking initial snapshot...');
        setTimeout(() => takeDailySnapshot(), 5000); // Wait 5s for server to stabilize
    }
});
