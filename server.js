// =====================================================
// XRP ETF Tracker - Complete Backend Server
// Includes: ETF Data API + Claude AI Insights + On-Chain + Chat + Email Reports
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
    'Futures ETFs': ['UXRP', 'XRPI', 'XRPM', 'XRPK', 'XRPT', 'XXRP'],
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
        }
        if (groupData.length > 0) results[groupName] = groupData;
    }
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
// EMAIL SUMMARY GENERATOR - Real Data from XRPL
// =====================================================

// Exchange wallet addresses
const EXCHANGE_WALLETS = {
    'Binance': ['rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh'],
    'Uphold': ['rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh'],
    'Bitso': ['rNRc2S2GSefSkTkAiyjE6LDzMonpeHp6jS'],
    'Kraken': ['raQxZLtqurEXvH5sgijrif7yXMNwvFRkJN'],
    'Bitstamp': ['rMvCasZ9cohYrSZRNYPTZfoaaSUQMfgQ8G'],
    'Coinbase': ['rwBHqnCgNRnk3Kyoc6zon6Wt4Wujj3HNGe'],
    'Robinhood': ['rEAKseZ7yNgaDuxH74PkqB12cVWohpi7R6']
};

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

// =====================================================
// XRPSCAN RICH LIST INTEGRATION
// =====================================================

let richListCache = { data: null, timestamp: 0 };
const RICH_LIST_CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

async function fetchRichListData() {
    // Check cache first
    const now = Date.now();
    if (richListCache.data && (now - richListCache.timestamp < RICH_LIST_CACHE_DURATION)) {
        return richListCache.data;
    }

    try {
        // XRPScan Metrics API provides distribution data
        const response = await fetch('https://api.xrpscan.com/api/v1/metrics', {
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) throw new Error(`XRPScan API error: ${response.status}`);
        
        const data = await response.json();
        
        // Structure the data for your frontend
        const richListData = {
            topAccounts: data.top_accounts || [], // Top balance holders
            distribution: data.distribution || {}, // Wealth brackets
            lastUpdate: new Date().toISOString()
        };

        // Update cache
        richListCache = { data: richListData, timestamp: now };
        return richListData;
    } catch (error) {
        console.error('Failed to fetch Rich List:', error.message);
        // Return old cache if available, or an empty object
        return richListCache.data || { error: "Data temporarily unavailable" };
    }
}

// New API Route for the Rich List
app.get('/api/onchain/rich-list', async (req, res) => {
    try {
        const data = await fetchRichListData();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});
// =====================================================
// XRPSCAN RICH LIST INTEGRATION (Updated)
// =====================================================

let richListCache = { data: null, timestamp: 0 };
const RICH_LIST_CACHE_DURATION = 15 * 60 * 1000; // 15 minutes cache

app.get('/api/onchain/rich-list', async (req, res) => {
    const now = Date.now();
    
    // 1. Check Cache to avoid Rate Limits
    if (richListCache.data && (now - richListCache.timestamp < RICH_LIST_CACHE_DURATION)) {
        return res.json({ ...richListCache.data, cached: true });
    }

    try {
        // 2. Fetch live data from XRPScan
        // Note: Using the metrics endpoint for distribution and the richlist endpoint for top accounts
        const [metricsRes, richListRes] = await Promise.all([
            fetch('https://api.xrpscan.com/api/v1/metrics'),
            fetch('https://api.xrpscan.com/api/v1/account/richlist?limit=50')
        ]);

        if (!metricsRes.ok || !richListRes.ok) {
            throw new Error('XRPScan API is currently unavailable');
        }

        const metrics = await metricsRes.json();
        const topAccountsRaw = await richListRes.json();

        // 3. Format data for your frontend
        const formattedData = {
            stats: {
                totalAccounts: metrics.accounts || 0,
                ledgerIndex: metrics.ledger_index || 0,
                updatedAt: new Date().toISOString()
            },
            distribution: metrics.distribution || [], // Wealth brackets
            topAccounts: topAccountsRaw.map((acc, index) => ({
                rank: index + 1,
                address: acc.account,
                balance: parseFloat(acc.balance),
                label: KNOWN_WALLET_LABELS[acc.account] || acc.label || 'Individual Whale'
            }))
        };

        // 4. Update Cache
        richListCache = { data: formattedData, timestamp: now };
        
        res.json({ ...formattedData, cached: false });

    } catch (error) {
        console.error('Rich List Error:', error.message);
        
        // If API fails, try to return stale cache or error
        if (richListCache.data) {
            return res.json({ ...richListCache.data, cached: true, warning: "Using stale data" });
        }
        res.status(503).json({ error: "XRPScan API unreachable. Please try again later." });
    }
});
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
    console.log('  GET  /api/sentiment         (live sentiment meter)');
    console.log('  GET  /api/onchain/escrow');
    console.log('  GET  /api/onchain/network');
    console.log('  GET  /api/onchain/odl');
    console.log('  GET  /api/onchain/dex');
    console.log('  GET  /api/x-post          (preview X post)');
    console.log('  POST /api/send-email      (manual trigger)');
    console.log('  GET  /api/email-status    (check schedule)');
    console.log('=========================================');
    console.log(`AI: ${anthropic ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`Email: ${emailEnabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log('=========================================');
    
    // Start email scheduler
    scheduleEmails();
});
