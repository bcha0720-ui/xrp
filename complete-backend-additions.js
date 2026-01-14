// ============================================
// COMPLETE BACKEND ADDITIONS FOR XRP ETF TRACKER
// ============================================
// Add all of this to your xrp-gtve backend (server.js)
// Make sure to add ANTHROPIC_API_KEY to your Render environment variables
// ============================================

// ============================================
// KNOWLEDGE BASE FOR RAG
// ============================================

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

// ============================================
// 1. CHAT ENDPOINT (Enhanced with RAG + Claude)
// ============================================

app.post('/api/chat', async (req, res) => {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    
    if (!ANTHROPIC_API_KEY) {
        return res.json({ success: false, error: 'AI not configured' });
    }

    try {
        const { question, marketData, chatHistory = [], language = 'en' } = req.body;
        
        // Find relevant knowledge base documents
        const relevantDocs = findRelevantDocs(question, 3);
        const ragContext = relevantDocs.length > 0 
            ? relevantDocs.map(d => `[${d.title}]: ${d.content}`).join('\n\n')
            : '';

        const langInstruction = language === 'ko' 
            ? 'Respond in Korean.' 
            : language === 'ja'
            ? 'Respond in Japanese.'
            : 'Respond in English.';

        const prompt = `You are a helpful XRP AI assistant integrated into an XRP ETF tracker dashboard. ${langInstruction}

## Current Market Data
- Price: $${(marketData?.currentPrice || 0).toFixed(4)}
- 24h Change: ${(marketData?.priceChange24h || 0).toFixed(2)}%
- 7d Change: ${(marketData?.priceChange7d || 0).toFixed(2)}%
- 7d MA: $${(marketData?.ma7 || 0).toFixed(4)}
- 30d MA: $${(marketData?.ma30 || 0).toFixed(4)}
- Sentiment: ${marketData?.sentiment || 50}/100

${ragContext ? `## Knowledge Base Context\n${ragContext}\n` : ''}

## User Question
${question}

## Instructions
- Be concise (under 150 words)
- Use the market data and knowledge base context when relevant
- Format with HTML for readability (use <br>, <strong>, <em>)
- If asked about price/technical analysis, reference the market data
- If asked about ETFs, SEC, or XRP basics, use the knowledge base context
- Always add a brief disclaimer for financial questions
- Be friendly and helpful`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 512,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!response.ok) {
            throw new Error('Claude API failed');
        }

        const data = await response.json();
        res.json({
            success: true,
            reply: data.content[0].text,
            sourcesUsed: relevantDocs.map(d => d.title)
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ============================================
// 2. AI INSIGHTS ENDPOINT (Claude)
// ============================================

app.post('/api/ai-insights', async (req, res) => {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    
    if (!ANTHROPIC_API_KEY) {
        return res.json({ success: false, error: 'AI not configured' });
    }

    try {
        const { marketData, language = 'en' } = req.body;
        const prompt = buildMarketAnalysisPrompt(marketData, language);
        
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 1024,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!response.ok) {
            throw new Error('Claude API failed');
        }

        const data = await response.json();
        res.json({
            success: true,
            analysis: data.content[0].text,
            cached: false
        });

    } catch (error) {
        console.error('AI insights error:', error);
        res.json({ success: false, error: error.message });
    }
});

function buildMarketAnalysisPrompt(data, language = 'en') {
    const langInstruction = language === 'ko' 
        ? 'Respond in Korean.' 
        : language === 'ja'
        ? 'Respond in Japanese.'
        : 'Respond in English.';

    return `You are an expert XRP market analyst. ${langInstruction}

## Market Data
- Price: $${(data.currentPrice || 0).toFixed(4)}
- 24h: ${(data.priceChange24h || 0).toFixed(2)}% | 7d: ${(data.priceChange7d || 0).toFixed(2)}% | 30d: ${(data.priceChange30d || 0).toFixed(2)}%
- 7d MA: $${(data.ma7 || 0).toFixed(4)} | 30d MA: $${(data.ma30 || 0).toFixed(4)} | 90d MA: $${(data.ma90 || 0).toFixed(4)}
- ETF Holdings: ${formatNum(data.etfHoldings || 0)} XRP
- Exchange Holdings: ${formatNum(data.exchangeHoldings || 0)} XRP
- Sentiment: ${data.sentimentScore || 50}/100

Write 4 paragraphs (under 200 words total):
1. Market Overview - current momentum
2. Technical Analysis - MA signals  
3. Institutional Flow - ETF/exchange implications
4. Outlook - short-term view

Be specific. No bullet points. End with brief disclaimer.`;
}

function formatNum(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
}


// ============================================
// 3. ON-CHAIN ANALYTICS ENDPOINTS
// ============================================

let onChainCache = { escrow: null, network: null, lastUpdate: null };

app.get('/api/onchain/escrow', async (req, res) => {
    try {
        if (onChainCache.escrow && Date.now() - onChainCache.lastUpdate < 300000) {
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
        res.json({ success: false, error: error.message });
    }
});

app.get('/api/onchain/network', async (req, res) => {
    try {
        if (onChainCache.network && Date.now() - onChainCache.lastUpdate < 300000) {
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
        res.json({ success: false, error: error.message });
    }
});

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
        res.json({ success: false, error: error.message });
    }
});


// ============================================
// ENVIRONMENT VARIABLE NEEDED:
// ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
// ============================================
