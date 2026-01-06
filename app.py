from flask import Flask, jsonify, request
from flask_cors import CORS
import yfinance as yf
from datetime import datetime, timedelta
import logging
import time
import os

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)

# =====================================================
# ANTHROPIC AI SETUP
# =====================================================
anthropic_client = None
try:
    import anthropic
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if api_key:
        anthropic_client = anthropic.Anthropic(api_key=api_key)
        logging.info("✅ Anthropic AI enabled")
    else:
        logging.warning("⚠️ No ANTHROPIC_API_KEY - AI insights disabled")
except ImportError:
    logging.warning("⚠️ anthropic package not installed - AI insights disabled")

# AI Insights cache
ai_cache = {
    'data': None,
    'timestamp': None,
    'cache_duration': 300  # 5 minutes
}

# Cache to store data and avoid rate limits
cache = {
    'data': None,
    'timestamp': None,
    'cache_duration': 300  # 5 minutes cache
}

groups = {
    "Spot ETFs": ['GXRP', 'XRP', 'XRPC', 'XRPZ', 'TOXR', 'XRPR'],
    "Futures ETFs": ['UXRP', 'XRPI', 'XRPM', 'XRPT', 'XXRP', 'XRPK'],
    "Index ETFs": ['EZPZ', 'GDLC', 'NCIQ', 'BITW'],
    "Canada ETFs": ['XRP.TO', 'XRPP-B.TO', 'XRPP-U.TO', 'XRPP.TO', 
                    'XRPQ-U.TO', 'XRPQ.TO', 'XRP.NE', 'XRPP.NE']
}

descriptions = {
    'EZPZ': 'Franklin Templeton',
    'GDLC': 'Grayscale Digital Large Cap',
    'NCIQ': 'Hashdex Nasdaq Crypto Index',
    'BITW': 'Bitwise 10 Crypto Index',
    'GXRP': 'Grayscale',
    'XRP': 'Bitwise XRP',
    'XRPC': 'Canary Capital XRP',
    'XRPZ': 'Franklin XRP',
    'TOXR': '21Shares',
    'UXRP': 'ProShares Ultra',
    'XRPI': 'Volatility Shares Trust',
    'XRPM': 'Amplify',
    'XRPR': 'REX-Osprey',
    'XRPK': 'T-REX 2X Long',
    'XRPT': 'Volatility Shares 2x',
    'XXRP': 'Teucrium 2x Long',
    'XRP.TO': 'Purpose',
    'XRPP-B.TO': 'Purpose',
    'XRPP-U.TO': 'Purpose USD Non-Hedged',
    'XRPP.TO': 'Purpose CAD Hedged',
    'XRPQ-U.TO': '3iQ USD',
    'XRPQ.TO': '3iQ',
    'XRP.NE': 'Canada ETF',
    'XRPP.NE': 'Purpose NEO'
}

def fetch_etf_data_batch():
    """Fetch all ETF data using batch download to minimize API calls"""
    data = {}
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    errors = []
    
    # Get all symbols
    all_symbols = []
    for symbols in groups.values():
        all_symbols.extend(symbols)
    
    logging.info(f"Fetching {len(all_symbols)} symbols in batch...")
    
    try:
        # Download history in batch - this makes fewer API calls
        logging.info("Downloading 5-day history...")
        hist_5d = yf.download(all_symbols, period="5d", group_by='ticker', progress=False, threads=False)
        time.sleep(2)
        
        logging.info("Downloading 1-month history...")
        hist_1mo = yf.download(all_symbols, period="1mo", group_by='ticker', progress=False, threads=False)
        time.sleep(2)
        
        logging.info("Downloading 1-year history...")
        hist_1y = yf.download(all_symbols, period="1y", group_by='ticker', progress=False, threads=False)
        
        # Process each group
        for group_name, symbols in groups.items():
            data[group_name] = []
            
            for symbol in symbols:
                try:
                    price = None
                    volume = 0
                    
                    # Get price from 5d history (most recent close)
                    if hist_5d is not None and not hist_5d.empty:
                        try:
                            if symbol in hist_5d.columns.get_level_values(0):
                                symbol_data = hist_5d[symbol]
                                if not symbol_data.empty and not symbol_data['Close'].isna().all():
                                    price = float(symbol_data['Close'].dropna().iloc[-1])
                                    vol_series = symbol_data['Volume'].dropna()
                                    volume = int(vol_series.iloc[-1]) if not vol_series.empty else 0
                        except Exception as e:
                            logging.warning(f"Error getting price for {symbol}: {e}")
                    
                    if price and price > 0:
                        etf_data = {
                            'symbol': symbol,
                            'description': descriptions.get(symbol, ''),
                            'price': round(price, 2),
                            'daily': {
                                'shares': volume,
                                'dollars': int(price * volume)
                            }
                        }
                        
                        # Weekly data (from 5d)
                        try:
                            if symbol in hist_5d.columns.get_level_values(0):
                                sym_5d = hist_5d[symbol].dropna()
                                if not sym_5d.empty and 'Volume' in sym_5d.columns:
                                    vol_week = int(sym_5d['Volume'].sum())
                                    dollar_week = int((sym_5d['Close'] * sym_5d['Volume']).sum())
                                    etf_data['weekly'] = {'shares': vol_week, 'dollars': dollar_week}
                        except:
                            pass
                        
                        # Monthly data
                        try:
                            if hist_1mo is not None and symbol in hist_1mo.columns.get_level_values(0):
                                sym_1mo = hist_1mo[symbol].dropna()
                                if not sym_1mo.empty and 'Volume' in sym_1mo.columns:
                                    vol_month = int(sym_1mo['Volume'].sum())
                                    dollar_month = int((sym_1mo['Close'] * sym_1mo['Volume']).sum())
                                    etf_data['monthly'] = {'shares': vol_month, 'dollars': dollar_month}
                        except:
                            pass
                        
                        # Yearly data
                        try:
                            if hist_1y is not None and symbol in hist_1y.columns.get_level_values(0):
                                sym_1y = hist_1y[symbol].dropna()
                                if not sym_1y.empty and 'Volume' in sym_1y.columns:
                                    vol_year = int(sym_1y['Volume'].sum())
                                    dollar_year = int((sym_1y['Close'] * sym_1y['Volume']).sum())
                                    etf_data['yearly'] = {'shares': vol_year, 'dollars': dollar_year}
                        except:
                            pass
                        
                        data[group_name].append(etf_data)
                        logging.info(f"✓ {symbol}: ${price}")
                    else:
                        errors.append(f"No price for {symbol}")
                        
                except Exception as e:
                    logging.error(f"Error processing {symbol}: {e}")
                    errors.append(f"{symbol}: {str(e)}")
    
    except Exception as e:
        logging.error(f"Batch download error: {e}")
        errors.append(f"Batch error: {str(e)}")
    
    return {
        'timestamp': timestamp,
        'data': data,
        'errors': errors if errors else None,
        'cached': False
    }

def get_cached_or_fetch():
    """Return cached data if valid, otherwise fetch new data"""
    now = datetime.now()
    
    # Check if cache is valid
    if cache['data'] and cache['timestamp']:
        age = (now - cache['timestamp']).total_seconds()
        if age < cache['cache_duration']:
            logging.info(f"Returning cached data (age: {int(age)}s)")
            result = cache['data'].copy()
            result['cached'] = True
            result['cache_age'] = int(age)
            return result
    
    # Fetch new data
    logging.info("Fetching fresh data...")
    result = fetch_etf_data_batch()
    
    # Update cache only if we got some data
    has_data = any(len(etfs) > 0 for etfs in result['data'].values())
    if has_data:
        cache['data'] = result
        cache['timestamp'] = now
    
    return result

@app.route('/api/etf-data', methods=['GET'])
def get_etf_data():
    """API endpoint to get all ETF data"""
    try:
        result = get_cached_or_fetch()
        return jsonify(result)
    except Exception as e:
        logging.error(f"API Error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/historical', methods=['GET'])
def get_historical():
    """API endpoint to get historical price data for charts"""
    try:
        period = request.args.get('period', '1mo')  # 1mo, 3mo, 6mo, 1y
        
        all_symbols = []
        for symbols in groups.values():
            all_symbols.extend(symbols)
        
        logging.info(f"Fetching historical data for {len(all_symbols)} symbols, period: {period}")
        
        # Download historical data
        hist = yf.download(all_symbols, period=period, group_by='ticker', progress=False, threads=False)
        
        historical_data = {}
        
        for symbol in all_symbols:
            try:
                if symbol in hist.columns.get_level_values(0):
                    symbol_data = hist[symbol]
                    if not symbol_data.empty and not symbol_data['Close'].isna().all():
                        closes = symbol_data['Close'].dropna()
                        volumes = symbol_data['Volume'].dropna()
                        
                        # Convert to list of {date, price, volume}
                        prices = []
                        for date, price in closes.items():
                            vol = volumes.get(date, 0)
                            prices.append({
                                'date': date.strftime('%Y-%m-%d'),
                                'price': round(float(price), 2),
                                'volume': int(vol) if vol else 0
                            })
                        
                        if prices:
                            historical_data[symbol] = prices
                            logging.info(f"✓ {symbol}: {len(prices)} data points")
            except Exception as e:
                logging.warning(f"Error processing {symbol}: {e}")
        
        return jsonify({
            'period': period,
            'data': historical_data,
            'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
        
    except Exception as e:
        logging.error(f"Historical API Error: {e}")
        return jsonify({'error': str(e)}), 500


# =====================================================
# AI INSIGHTS ENDPOINT
# =====================================================

def build_ai_prompt(market_data):
    """Build the prompt for Claude AI"""
    current_price = market_data.get('currentPrice', 0)
    price_change_24h = market_data.get('priceChange24h', 0)
    price_change_7d = market_data.get('priceChange7d', 0)
    price_change_30d = market_data.get('priceChange30d', 0)
    volume_24h = market_data.get('volume24h', 0)
    ma7 = market_data.get('ma7', 0)
    ma30 = market_data.get('ma30', 0)
    ma90 = market_data.get('ma90', 0)
    etf_holdings = market_data.get('etfHoldings', 0)
    exchange_holdings = market_data.get('exchangeHoldings', 0)
    etf_volume = market_data.get('etfVolume', 0)
    sentiment_score = market_data.get('sentimentScore', 50)
    
    def format_large_number(num):
        if not num or num == 0:
            return '0'
        if num >= 1e12:
            return f'{num/1e12:.2f}T'
        if num >= 1e9:
            return f'{num/1e9:.2f}B'
        if num >= 1e6:
            return f'{num/1e6:.2f}M'
        if num >= 1e3:
            return f'{num/1e3:.1f}K'
        return f'{num:,.0f}'
    
    def get_sentiment_label(score):
        if score >= 70:
            return 'Bullish'
        if score >= 55:
            return 'Slightly Bullish'
        if score >= 45:
            return 'Neutral'
        if score >= 30:
            return 'Slightly Bearish'
        return 'Bearish'
    
    price_vs_ma7 = 'Above' if current_price > ma7 else 'Below'
    price_vs_ma30 = 'Above' if current_price > ma30 else 'Below'
    price_vs_ma90 = 'Above' if ma90 > 0 and current_price > ma90 else ('Below' if ma90 > 0 else 'N/A')
    
    return f"""You are an expert cryptocurrency market analyst specializing in XRP and crypto ETFs. Analyze the following real-time market data and provide professional insights.

## CURRENT XRP MARKET DATA

### Price Information
- Current Price: ${current_price:.4f}
- 24h Change: {'+' if price_change_24h >= 0 else ''}{price_change_24h:.2f}%
- 7-Day Change: {'+' if price_change_7d >= 0 else ''}{price_change_7d:.2f}%
- 30-Day Change: {'+' if price_change_30d >= 0 else ''}{price_change_30d:.2f}%
- 24h Trading Volume: ${format_large_number(volume_24h)}

### Technical Indicators
- 7-Day Moving Average: ${ma7:.4f} (Price is {price_vs_ma7})
- 30-Day Moving Average: ${ma30:.4f} (Price is {price_vs_ma30})
- 90-Day Moving Average: {'$' + f'{ma90:.4f}' if ma90 > 0 else 'N/A'} (Price is {price_vs_ma90})

### Institutional & Exchange Data
- Total XRP in Spot ETFs: {format_large_number(etf_holdings)} XRP (≈${format_large_number(etf_holdings * current_price)})
- ETF Daily Trading Volume: ${format_large_number(etf_volume)}
- XRP on Exchanges: {format_large_number(exchange_holdings)} XRP

### Calculated Sentiment: {sentiment_score}/100 ({get_sentiment_label(sentiment_score)})

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
- End with a clear, actionable takeaway"""


@app.route('/api/ai-insights', methods=['POST'])
def get_ai_insights():
    """API endpoint to get AI-generated market insights"""
    
    # Check if AI is enabled
    if not anthropic_client:
        return jsonify({
            'error': 'AI insights not available',
            'message': 'ANTHROPIC_API_KEY not configured or anthropic package not installed'
        }), 503
    
    try:
        # Get market data from request
        data = request.get_json()
        if not data or 'marketData' not in data:
            return jsonify({'error': 'Market data is required'}), 400
        
        market_data = data['marketData']
        force_refresh = data.get('forceRefresh', False)
        
        # Check cache
        now = datetime.now()
        if not force_refresh and ai_cache['data'] and ai_cache['timestamp']:
            age = (now - ai_cache['timestamp']).total_seconds()
            if age < ai_cache['cache_duration']:
                logging.info(f"Returning cached AI insights (age: {int(age)}s)")
                return jsonify({
                    'success': True,
                    'analysis': ai_cache['data'],
                    'cached': True,
                    'cacheAge': int(age),
                    'timestamp': ai_cache['timestamp'].strftime("%Y-%m-%d %H:%M:%S")
                })
        
        # Build prompt
        prompt = build_ai_prompt(market_data)
        
        logging.info("Calling Claude AI...")
        
        # Call Claude API
        message = anthropic_client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=1000,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )
        
        analysis = message.content[0].text
        
        # Update cache
        ai_cache['data'] = analysis
        ai_cache['timestamp'] = now
        
        logging.info("✅ AI insights generated successfully")
        
        return jsonify({
            'success': True,
            'analysis': analysis,
            'cached': False,
            'model': 'claude-3-5-haiku',
            'timestamp': now.strftime("%Y-%m-%d %H:%M:%S"),
            'usage': {
                'inputTokens': message.usage.input_tokens,
                'outputTokens': message.usage.output_tokens
            }
        })
        
    except Exception as e:
        logging.error(f"AI Insights Error: {e}")
        
        # Return cached data if available
        if ai_cache['data']:
            return jsonify({
                'success': True,
                'analysis': ai_cache['data'],
                'cached': True,
                'stale': True,
                'error': 'Using cached data due to API error'
            })
        
        return jsonify({
            'error': 'Failed to generate insights',
            'message': str(e)
        }), 500


@app.route('/api/ai-insights/health', methods=['GET'])
def ai_health_check():
    """Health check for AI insights endpoint"""
    return jsonify({
        'status': 'ok',
        'aiEnabled': anthropic_client is not None,
        'hasApiKey': os.environ.get('ANTHROPIC_API_KEY') is not None,
        'cacheStatus': 'has_cache' if ai_cache['data'] else 'empty',
        'cacheAge': int((datetime.now() - ai_cache['timestamp']).total_seconds()) if ai_cache['timestamp'] else None
    })


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        'cache_valid': cache['data'] is not None,
        'ai_enabled': anthropic_client is not None
    })

@app.route('/api/clear-cache', methods=['GET'])
def clear_cache():
    """Clear the cache to force fresh data"""
    cache['data'] = None
    cache['timestamp'] = None
    ai_cache['data'] = None
    ai_cache['timestamp'] = None
    return jsonify({'message': 'Cache cleared (ETF + AI)'})

@app.route('/', methods=['GET'])
def home():
    """Home endpoint with API info"""
    return jsonify({
        'message': 'XRP ETF API',
        'version': '2.0',
        'ai_enabled': anthropic_client is not None,
        'endpoints': {
            '/api/etf-data': 'Get all ETF data (cached 5 min)',
            '/api/historical': 'Get historical price data',
            '/api/ai-insights': 'POST - Get AI market analysis',
            '/api/ai-insights/health': 'Check AI status',
            '/api/health': 'Health check',
            '/api/clear-cache': 'Clear cache'
        }
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
