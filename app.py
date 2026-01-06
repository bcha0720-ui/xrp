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

# Anthropic AI Setup
anthropic_client = None
try:
    import anthropic
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if api_key:
        anthropic_client = anthropic.Anthropic(api_key=api_key)
        logging.info("Anthropic AI enabled")
    else:
        logging.warning("No ANTHROPIC_API_KEY - AI insights disabled")
except ImportError:
    logging.warning("anthropic package not installed")

# Caches
ai_cache = {'data': None, 'timestamp': None, 'cache_duration': 300}
cache = {'data': None, 'timestamp': None, 'cache_duration': 300}

groups = {
    "Spot ETFs": ['GXRP', 'XRP', 'XRPC', 'XRPZ', 'TOXR', 'XRPR'],
    "Futures ETFs": ['UXRP', 'XRPI', 'XRPM', 'XRPT', 'XXRP', 'XRPK'],
    "Index ETFs": ['EZPZ', 'GDLC', 'NCIQ', 'BITW'],
    "Canada ETFs": ['XRP.TO', 'XRPP-B.TO', 'XRPP-U.TO', 'XRPP.TO', 'XRPQ-U.TO', 'XRPQ.TO', 'XRP.NE', 'XRPP.NE']
}

descriptions = {
    'EZPZ': 'Franklin Templeton', 'GDLC': 'Grayscale Digital Large Cap',
    'NCIQ': 'Hashdex Nasdaq Crypto Index', 'BITW': 'Bitwise 10 Crypto Index',
    'GXRP': 'Grayscale', 'XRP': 'Bitwise XRP', 'XRPC': 'Canary Capital XRP',
    'XRPZ': 'Franklin XRP', 'TOXR': '21Shares', 'UXRP': 'ProShares Ultra',
    'XRPI': 'Volatility Shares Trust', 'XRPM': 'Amplify', 'XRPR': 'REX-Osprey',
    'XRPK': 'T-REX 2X Long', 'XRPT': 'Volatility Shares 2x', 'XXRP': 'Teucrium 2x Long',
    'XRP.TO': 'Purpose', 'XRPP-B.TO': 'Purpose', 'XRPP-U.TO': 'Purpose USD Non-Hedged',
    'XRPP.TO': 'Purpose CAD Hedged', 'XRPQ-U.TO': '3iQ USD', 'XRPQ.TO': '3iQ',
    'XRP.NE': 'Canada ETF', 'XRPP.NE': 'Purpose NEO'
}

def fetch_etf_data_batch():
    data = {}
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    errors = []
    all_symbols = []
    for symbols in groups.values():
        all_symbols.extend(symbols)
    
    logging.info(f"Fetching {len(all_symbols)} symbols...")
    
    try:
        hist_5d = yf.download(all_symbols, period="5d", group_by='ticker', progress=False, threads=False)
        time.sleep(2)
        hist_1mo = yf.download(all_symbols, period="1mo", group_by='ticker', progress=False, threads=False)
        time.sleep(2)
        hist_1y = yf.download(all_symbols, period="1y", group_by='ticker', progress=False, threads=False)
        
        for group_name, symbols in groups.items():
            data[group_name] = []
            for symbol in symbols:
                try:
                    price = None
                    volume = 0
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
                            'daily': {'shares': volume, 'dollars': int(price * volume)}
                        }
                        try:
                            if symbol in hist_5d.columns.get_level_values(0):
                                sym_5d = hist_5d[symbol].dropna()
                                if not sym_5d.empty and 'Volume' in sym_5d.columns:
                                    vol_week = int(sym_5d['Volume'].sum())
                                    dollar_week = int((sym_5d['Close'] * sym_5d['Volume']).sum())
                                    etf_data['weekly'] = {'shares': vol_week, 'dollars': dollar_week}
                        except:
                            pass
                        try:
                            if hist_1mo is not None and symbol in hist_1mo.columns.get_level_values(0):
                                sym_1mo = hist_1mo[symbol].dropna()
                                if not sym_1mo.empty and 'Volume' in sym_1mo.columns:
                                    vol_month = int(sym_1mo['Volume'].sum())
                                    dollar_month = int((sym_1mo['Close'] * sym_1mo['Volume']).sum())
                                    etf_data['monthly'] = {'shares': vol_month, 'dollars': dollar_month}
                        except:
                            pass
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
                        logging.info(f"Got {symbol}: ${price}")
                    else:
                        errors.append(f"No price for {symbol}")
                except Exception as e:
                    errors.append(f"{symbol}: {str(e)}")
    except Exception as e:
        errors.append(f"Batch error: {str(e)}")
    
    return {'timestamp': timestamp, 'data': data, 'errors': errors if errors else None, 'cached': False}

def get_cached_or_fetch():
    now = datetime.now()
    if cache['data'] and cache['timestamp']:
        age = (now - cache['timestamp']).total_seconds()
        if age < cache['cache_duration']:
            result = cache['data'].copy()
            result['cached'] = True
            result['cache_age'] = int(age)
            return result
    result = fetch_etf_data_batch()
    has_data = any(len(etfs) > 0 for etfs in result['data'].values())
    if has_data:
        cache['data'] = result
        cache['timestamp'] = now
    return result

@app.route('/api/etf-data', methods=['GET'])
def get_etf_data():
    try:
        result = get_cached_or_fetch()
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/ai-insights', methods=['POST'])
def get_ai_insights():
    if not anthropic_client:
        return jsonify({'error': 'AI not available', 'message': 'No API key'}), 503
    try:
        data = request.get_json()
        if not data or 'marketData' not in data:
            return jsonify({'error': 'Market data required'}), 400
        market_data = data['marketData']
        now = datetime.now()
        if ai_cache['data'] and ai_cache['timestamp']:
            age = (now - ai_cache['timestamp']).total_seconds()
            if age < ai_cache['cache_duration']:
                return jsonify({'success': True, 'analysis': ai_cache['data'], 'cached': True})
        
        prompt = f"""Analyze this XRP market data and provide 4 paragraphs: Market Overview, Technical Analysis, Institutional Flow, Outlook.
Price: ${market_data.get('currentPrice', 0):.4f}
24h Change: {market_data.get('priceChange24h', 0):.2f}%
7d Change: {market_data.get('priceChange7d', 0):.2f}%
7-Day MA: ${market_data.get('ma7', 0):.4f}
30-Day MA: ${market_data.get('ma30', 0):.4f}
ETF Holdings: {market_data.get('etfHoldings', 0):,} XRP
Sentiment: {market_data.get('sentimentScore', 50)}/100
Be concise and professional."""

        message = anthropic_client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}]
        )
        analysis = message.content[0].text
        ai_cache['data'] = analysis
        ai_cache['timestamp'] = now
        return jsonify({'success': True, 'analysis': analysis, 'cached': False})
    except Exception as e:
        if ai_cache['data']:
            return jsonify({'success': True, 'analysis': ai_cache['data'], 'cached': True, 'stale': True})
        return jsonify({'error': str(e)}), 500

@app.route('/api/chat', methods=['POST'])
def chat():
    if not anthropic_client:
        return jsonify({'success': False, 'error': 'AI not available'}), 503
    try:
        data = request.get_json()
        question = data.get('question', '')
        market_data = data.get('marketData', {})
        chat_history = data.get('chatHistory', [])
        
        # Build context with market data
        context = f"""You are an XRP market assistant. Be helpful, concise, and friendly. Use emojis occasionally.

Current XRP Market Data:
- Price: ${market_data.get('currentPrice', 0):.4f}
- 24h Change: {market_data.get('priceChange24h', 0):.2f}%
- 7d Change: {market_data.get('priceChange7d', 0):.2f}%
- 30d Change: {market_data.get('priceChange30d', 0):.2f}%
- 7-Day MA: ${market_data.get('ma7', 0):.4f}
- 30-Day MA: ${market_data.get('ma30', 0):.4f}
- Market Sentiment: {market_data.get('sentiment', 50)}/100
- 24h Volume: ${market_data.get('volume24h', 0):,.0f}

XRP Spot ETFs trading in US: GXRP (Grayscale), XRP (Bitwise), XRPC (Canary), XRPZ (Franklin), TOXR (21Shares), XRPR (REX-Osprey)

Guidelines:
- Keep responses under 150 words
- Use bullet points for lists
- Include specific numbers from the data
- Add disclaimer for investment advice
- Be conversational and helpful"""

        # Build messages with history
        messages = []
        for msg in chat_history[-4:]:  # Last 4 messages for context
            role = "user" if msg.get('role') == 'user' else "assistant"
            messages.append({"role": role, "content": msg.get('content', '')})
        
        messages.append({"role": "user", "content": question})
        
        response = anthropic_client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=500,
            system=context,
            messages=messages
        )
        
        reply = response.content[0].text
        
        # Format for HTML display
        reply = reply.replace('\n\n', '<br><br>').replace('\n', '<br>')
        reply = reply.replace('**', '<strong>').replace('**', '</strong>')
        
        return jsonify({'success': True, 'reply': reply})
    except Exception as e:
        logging.error(f"Chat error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/ai-insights/health', methods=['GET'])
def ai_health():
    return jsonify({
        'status': 'ok',
        'aiEnabled': anthropic_client is not None,
        'hasApiKey': os.environ.get('ANTHROPIC_API_KEY') is not None
    })

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy', 'ai_enabled': anthropic_client is not None})

@app.route('/', methods=['GET'])
def home():
    return jsonify({'message': 'XRP ETF API', 'ai_enabled': anthropic_client is not None})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
