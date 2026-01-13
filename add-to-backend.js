// ============================================
// ADD THIS TO YOUR EXISTING xrp-gtve BACKEND
// ============================================

// 1. First, add at the top of your server file:
// require('dotenv').config(); // if not already there

// 2. Add this endpoint (replace your existing /api/ai-insights if you have one):

app.post('/api/ai-insights', async (req, res) => {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    
    if (!ANTHROPIC_API_KEY) {
        console.log('ANTHROPIC_API_KEY not configured');
        return res.json({ success: false, error: 'AI not configured' });
    }

    try {
        const { marketData, language = 'en' } = req.body;
        
        // Build the prompt with market data
        const prompt = buildMarketAnalysisPrompt(marketData, language);
        
        // Call Claude API
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
            const errorData = await response.json().catch(() => ({}));
            console.error('Claude API error:', response.status, errorData);
            return res.json({ success: false, error: 'AI request failed' });
        }

        const data = await response.json();
        const analysis = data.content[0].text;

        res.json({
            success: true,
            analysis: analysis,
            cached: false
        });

    } catch (error) {
        console.error('AI insights error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 3. Add this helper function:

function buildMarketAnalysisPrompt(data, language = 'en') {
    const langInstruction = language === 'ko' 
        ? 'Respond in Korean (한국어로 응답하세요).' 
        : language === 'ja'
        ? 'Respond in Japanese (日本語で応答してください).'
        : 'Respond in English.';

    return `You are an expert XRP market analyst. Analyze the following market data and provide a concise, professional analysis.

${langInstruction}

## Current Market Data

**Price:**
- Current Price: $${(data.currentPrice || 0).toFixed(4)}
- 24h Change: ${(data.priceChange24h || 0).toFixed(2)}%
- 7d Change: ${(data.priceChange7d || 0).toFixed(2)}%
- 30d Change: ${(data.priceChange30d || 0).toFixed(2)}%

**Moving Averages:**
- 7-day MA: $${(data.ma7 || 0).toFixed(4)}
- 30-day MA: $${(data.ma30 || 0).toFixed(4)}
- 90-day MA: $${(data.ma90 || 0).toFixed(4)}

**Institutional Data:**
- ETF Holdings: ${formatNumber(data.etfHoldings || 0)} XRP
- Exchange Holdings: ${formatNumber(data.exchangeHoldings || 0)} XRP
- ETF 24h Volume: $${formatNumber(data.etfVolume || 0)}

**Sentiment Score:** ${data.sentimentScore || 50}/100

## Instructions
Write a professional market analysis in 4 paragraphs:

1. **Market Overview:** Current price action and short-term momentum
2. **Technical Analysis:** Moving average analysis and what it indicates
3. **Institutional Flow:** ETF holdings significance and exchange flow implications  
4. **Outlook:** Short-term outlook with key levels to watch

Keep it concise (under 200 words total). Be specific with numbers. Do not use bullet points - write in flowing paragraphs. End with a brief risk disclaimer.`;
}

function formatNumber(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
}

// ============================================
// ENVIRONMENT VARIABLE
// ============================================
// Add to your Render environment variables:
// ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
// ============================================
