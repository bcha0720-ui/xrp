from flask import Flask, jsonify, request
from flask_cors import CORS
import yfinance as yf
from datetime import datetime, timedelta
import logging
import time
import os
import requests

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

# =====================================================
# LUNARCRUSH API CONFIGURATION
# =====================================================
LUNARCRUSH_API_KEY = os.environ.get('LUNARCRUSH_API_KEY', '00kyv32gahqdkkkxcieql160hz89ml0c542vj4hkro6')
LUNARCRUSH_BASE_URL = 'https://lunarcrush.com/api4/public'

# Caches
ai_cache = {'data': None, 'timestamp': None, 'cache_duration': 300}
cache = {'data': None, 'timestamp': None, 'cache_duration': 300}
historical_cache = {'data': None, 'timestamp': None, 'cache_duration': 600}  # 10 min cache for historical
richlist_cache = {'data': None, 'timestamp': None, 'cache_duration': 86400}  # 24 hour cache for rich list
burn_cache = {'data': None, 'timestamp': None, 'cache_duration': 3600}  # 1 hour cache for burn data

# LunarCrush caches (5 minute cache)
lunarcrush_cache = {}
LUNARCRUSH_CACHE_DURATION = 300

# XRPL API endpoints
XRPSCAN_BASE = "https://api.xrpscan.com/api/v1"
RIPPLED_URLS = [
    "https://xrplcluster.com",
    "https://s1.ripple.com:51234",
    "https://s2.ripple.com:51234"
]

groups = {
    "Spot ETFs": ['GXRP', 'XRP', 'XRPC', 'XRPZ', 'TOXR', 'XRPR'],
    "Futures ETFs": ['UXRP', 'XRPI', 'XRPM', 'XRPT', 'XXRP', 'XRPK'],
    "Index ETFs": ['EZPZ', 'GDLC', 'NCIQ', 'BITW'],
    "Canada ETFs": ['XRP.TO', 'XRPP-B.TO', 'XRPP-U.TO', 'XRPP.TO', 'XRPQ-U.TO', 'XRPQ.TO', 'XRP.NE', 'XRPP.NE']
}

# XRP Spot ETFs for historical chart (main focus)
spot_etf_symbols = ['GXRP', 'XRP', 'XRPC', 'XRPZ', 'TOXR', 'XRPR']

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

# =====================================================
# LUNARCRUSH HELPER FUNCTIONS
# =====================================================

def get_lunarcrush_cached(key):
    """Get cached LunarCrush data if not expired"""
    if key in lunarcrush_cache:
        data, timestamp = lunarcrush_cache[key]
        if time.time() - timestamp < LUNARCRUSH_CACHE_DURATION:
            return data
    return None

def set_lunarcrush_cache(key, data):
    """Set LunarCrush cache with timestamp"""
    lunarcrush_cache[key] = (data, time.time())

def lunarcrush_request(endpoint, params=None):
    """Make authenticated request to LunarCrush API"""
    url = f"{LUNARCRUSH_BASE_URL}{endpoint}"
    headers = {
        'Authorization': f'Bearer {LUNARCRUSH_API_KEY}'
    }
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"LunarCrush API error: {e}")
        return None

# =====================================================
# LUNARCRUSH API ENDPOINTS
# =====================================================

@app.route('/api/xrp/topic')
def get_xrp_topic():
    """Get XRP social topic data"""
    cache_key = 'xrp_topic'
    cached = get_lunarcrush_cached(cache_key)
    if cached:
        return jsonify({'data': cached, 'cached': True})
    
    result = lunarcrush_request('/topic/xrp/v1')
    if result:
        data = result.get('data', result)
        set_lunarcrush_cache(cache_key, data)
        return jsonify({'data': data, 'cached': False})
    
    return jsonify({'error': 'Failed to fetch topic data'}), 500

@app.route('/api/xrp/posts')
def get_xrp_posts():
    """Get top XRP social posts"""
    cache_key = 'xrp_posts'
    cached = get_lunarcrush_cached(cache_key)
    if cached:
        return jsonify({'data': cached, 'cached': True})
    
    result = lunarcrush_request('/topic/xrp/posts/v1')
    if result:
        data = result.get('data', [])
        set_lunarcrush_cache(cache_key, data)
        return jsonify({'data': data, 'cached': False})
    
    return jsonify({'error': 'Failed to fetch posts'}), 500

@app.route('/api/xrp/timeseries')
def get_xrp_timeseries():
    """Get XRP social time series data"""
    bucket = request.args.get('bucket', 'day')
    interval = request.args.get('interval', '1w')
    
    cache_key = f'xrp_timeseries_{bucket}_{interval}'
    cached = get_lunarcrush_cached(cache_key)
    if cached:
        return jsonify({'data': cached, 'cached': True})
    
    result = lunarcrush_request(f'/topic/xrp/time-series/v1', {
        'bucket': bucket,
        'interval': interval
    })
    if result:
        data = result.get('data', [])
        set_lunarcrush_cache(cache_key, data)
        return jsonify({'data': data, 'cached': False})
    
    return jsonify({'error': 'Failed to fetch timeseries'}), 500

@app.route('/api/xrp/creators')
def get_xrp_creators():
    """Get top XRP content creators"""
    cache_key = 'xrp_creators'
    cached = get_lunarcrush_cached(cache_key)
    if cached:
        return jsonify({'data': cached, 'cached': True})
    
    result = lunarcrush_request('/topic/xrp/creators/v1')
    if result:
        data = result.get('data', [])
        set_lunarcrush_cache(cache_key, data)
        return jsonify({'data': data, 'cached': False})
    
    return jsonify({'error': 'Failed to fetch creators'}), 500

@app.route('/api/xrp/news')
def get_xrp_news():
    """Get XRP news articles"""
    cache_key = 'xrp_news'
    cached = get_lunarcrush_cached(cache_key)
    if cached:
        return jsonify({'data': cached, 'cached': True})
    
    result = lunarcrush_request('/topic/xrp/news/v1')
    if result:
        data = result.get('data', [])
        set_lunarcrush_cache(cache_key, data)
        return jsonify({'data': data, 'cached': False})
    
    return jsonify({'error': 'Failed to fetch news'}), 500

@app.route('/api/xrp/coin')
def get_xrp_coin():
    """Get XRP coin market data"""
    cache_key = 'xrp_coin'
    cached = get_lunarcrush_cached(cache_key)
    if cached:
        return jsonify({'data': cached, 'cached': True})
    
    result = lunarcrush_request('/coins/xrp/v1')
    if result:
        data = result.get('data', result)
        set_lunarcrush_cache(cache_key, data)
        return jsonify({'data': data, 'cached': False})
    
    return jsonify({'error': 'Failed to fetch coin data'}), 500

@app.route('/api/xrp/all')
def get_xrp_all():
    """Get all XRP data in one request (topic, posts, timeseries, coin, news)"""
    cache_key = 'xrp_all'
    cached = get_lunarcrush_cached(cache_key)
    if cached:
        return jsonify({'data': cached, 'cached': True})
    
    # Fetch all data
    topic = lunarcrush_request('/topic/xrp/v1')
    posts = lunarcrush_request('/topic/xrp/posts/v1')
    timeseries = lunarcrush_request('/topic/xrp/time-series/v1', {'bucket': 'day', 'interval': '1w'})
    coin = lunarcrush_request('/coins/xrp/v1')
    news = lunarcrush_request('/topic/xrp/news/v1')
    
    data = {
        'topic': topic.get('data', topic) if topic else None,
        'posts': posts.get('data', []) if posts else [],
        'timeseries': timeseries.get('data', []) if timeseries else [],
        'coin': coin.get('data', coin) if coin else None,
        'news': news.get('data', [])[:5] if news else [],
        'timestamp': datetime.utcnow().isoformat()
    }
    
    set_lunarcrush_cache(cache_key, data)
    return jsonify({'data': data, 'cached': False})

@app.route('/api/xrp/whatsup')
def get_xrp_whatsup():
    """Get AI-generated summary of XRP news and social activity"""
    cache_key = 'xrp_whatsup'
    cached = get_lunarcrush_cached(cache_key)
    if cached:
        return jsonify({'data': cached, 'cached': True})
    
    result = lunarcrush_request('/topic/xrp/whatsup/v1')
    if result:
        set_lunarcrush_cache(cache_key, result)
        return jsonify({'data': result, 'cached': False})
    
    return jsonify({'error': 'Failed to fetch whatsup'}), 500

# =====================================================
# EXISTING ETF DATA FUNCTIONS
# =====================================================

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

# =====================================================
# HISTORICAL DATA ENDPOINT
# =====================================================
def fetch_historical_data(period='1mo'):
    """Fetch historical price and volume data for XRP Spot ETFs"""
    
    # Map period to yfinance period string
    period_map = {
        '1mo': '1mo',
        '3mo': '3mo', 
        '6mo': '6mo',
        '1y': '1y'
    }
    yf_period = period_map.get(period, '1mo')
    
    logging.info(f"Fetching historical data for period: {yf_period}")
    
    data = {}
    errors = []
    
    try:
        # Download historical data for spot ETFs
        hist = yf.download(
            spot_etf_symbols, 
            period=yf_period, 
            group_by='ticker', 
            progress=False, 
            threads=False
        )
        
        if hist is None or hist.empty:
            logging.warning("No historical data returned from yfinance")
            return {'data': {}, 'errors': ['No data available']}
        
        for symbol in spot_etf_symbols:
            try:
                symbol_data = []
                
                if symbol in hist.columns.get_level_values(0):
                    sym_hist = hist[symbol].dropna()
                    
                    if not sym_hist.empty:
                        for date, row in sym_hist.iterrows():
                            try:
                                close_price = float(row['Close']) if 'Close' in row else None
                                volume = int(row['Volume']) if 'Volume' in row and not pd.isna(row['Volume']) else 0
                                
                                if close_price and close_price > 0:
                                    symbol_data.append({
                                        'date': date.strftime('%Y-%m-%d'),
                                        'price': round(close_price, 2),
                                        'volume': volume,
                                        'dollar_volume': int(close_price * volume)
                                    })
                            except Exception as e:
                                logging.warning(f"Error processing row for {symbol}: {e}")
                        
                        if symbol_data:
                            data[symbol] = {
                                'description': descriptions.get(symbol, ''),
                                'history': symbol_data
                            }
                            logging.info(f"Got {len(symbol_data)} days of history for {symbol}")
                
            except Exception as e:
                errors.append(f"{symbol}: {str(e)}")
                logging.warning(f"Error processing {symbol}: {e}")
    
    except Exception as e:
        errors.append(f"Batch error: {str(e)}")
        logging.error(f"Historical fetch error: {e}")
    
    return {
        'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        'period': period,
        'data': data,
        'errors': errors if errors else None
    }

@app.route('/api/historical', methods=['GET'])
def get_historical():
    """Get historical ETF data for charts"""
    try:
        period = request.args.get('period', '1mo')
        
        # Check cache
        now = datetime.now()
        cache_key = f'historical_{period}'
        
        if historical_cache.get(cache_key) and historical_cache.get(f'{cache_key}_timestamp'):
            age = (now - historical_cache[f'{cache_key}_timestamp']).total_seconds()
            if age < historical_cache['cache_duration']:
                result = historical_cache[cache_key].copy()
                result['cached'] = True
                result['cache_age'] = int(age)
                return jsonify(result)
        
        # Fetch fresh data
        result = fetch_historical_data(period)
        
        # Cache if we got data
        if result.get('data'):
            historical_cache[cache_key] = result
            historical_cache[f'{cache_key}_timestamp'] = now
        
        result['cached'] = False
        return jsonify(result)
        
    except Exception as e:
        logging.error(f"Historical endpoint error: {e}")
        return jsonify({'error': str(e)}), 500

# =====================================================
# RICHLIST ENDPOINT
# =====================================================
@app.route('/api/richlist', methods=['GET'])
def get_richlist():
    """Get XRP rich list from XRPScan API"""
    try:
        refresh = request.args.get('refresh', 'false').lower() == 'true'
        limit = int(request.args.get('limit', 10000))
        
        now = datetime.now()
        
        # Check cache unless refresh requested
        if not refresh and richlist_cache['data'] and richlist_cache['timestamp']:
            age = (now - richlist_cache['timestamp']).total_seconds()
            if age < richlist_cache['cache_duration']:
                result = richlist_cache['data'].copy()
                result['cached'] = True
                result['cache_age'] = int(age)
                return jsonify(result)
        
        # Fetch from XRPScan API
        logging.info(f"Fetching rich list from XRPScan (limit: {limit})")
        
        response = requests.get(
            f"{XRPSCAN_BASE}/balances/top",
            params={'limit': min(limit, 10000)},  # XRPScan max is 10000
            timeout=30
        )
        response.raise_for_status()
        
        data = response.json()
        
        result = {
            'timestamp': now.strftime("%Y-%m-%d %H:%M:%S"),
            'count': len(data) if isinstance(data, list) else 0,
            'accounts': data,
            'cached': False
        }
        
        # Cache the result
        richlist_cache['data'] = result
        richlist_cache['timestamp'] = now
        
        return jsonify(result)
        
    except requests.exceptions.RequestException as e:
        logging.error(f"XRPScan API error: {e}")
        
        # Return cached data if available
        if richlist_cache['data']:
            result = richlist_cache['data'].copy()
            result['cached'] = True
            result['stale'] = True
            return jsonify(result)
        
        return jsonify({'error': f'XRPScan API error: {str(e)}'}), 500
    except Exception as e:
        logging.error(f"Richlist endpoint error: {e}")
        return jsonify({'error': str(e)}), 500

# =====================================================
# BURN DATA ENDPOINT
# =====================================================
def make_rippled_request(method, params=None):
    """Make request to rippled server with fallback"""
    payload = {
        "method": method,
        "params": [params] if params else [{}]
    }
    
    for url in RIPPLED_URLS:
        try:
            response = requests.post(url, json=payload, timeout=10)
            if response.status_code == 200:
                result = response.json()
                if 'result' in result:
                    return result['result']
        except Exception as e:
            logging.warning(f"Rippled request to {url} failed: {e}")
            continue
    
    return None

@app.route('/api/burn', methods=['GET'])
def get_burn_data():
    """Get XRP burn statistics from XRPL"""
    try:
        refresh = request.args.get('refresh', 'false').lower() == 'true'
        now = datetime.now()
        
        # Check cache unless refresh requested
        if not refresh and burn_cache['data'] and burn_cache['timestamp']:
            age = (now - burn_cache['timestamp']).total_seconds()
            if age < burn_cache['cache_duration']:
                result = burn_cache['data'].copy()
                result['cached'] = True
                result['cache_age'] = int(age)
                return jsonify(result)
        
        logging.info("Fetching burn data from XRPL")
        
        # Get current ledger info
        server_info = make_rippled_request("server_info")
        if not server_info:
            return jsonify({'error': 'Could not connect to XRPL'}), 500
        
        ledger_info = server_info.get('info', {}).get('validated_ledger', {})
        current_ledger_index = ledger_info.get('seq', 0)
        
        # Get current total coins (drops)
        ledger_data = make_rippled_request("ledger", {"ledger_index": "validated"})
        if not ledger_data or 'ledger' not in ledger_data:
            return jsonify({'error': 'Could not fetch ledger data'}), 500
        
        total_coins = int(ledger_data['ledger'].get('total_coins', 0))
        current_supply_xrp = total_coins / 1_000_000  # Convert drops to XRP
        
        # Original supply was 100 billion XRP
        original_supply = 100_000_000_000
        total_burned_xrp = original_supply - current_supply_xrp
        
        # Calculate burns for different periods
        burn_data = {}
        now_ts = int(time.time())
        
        def find_ledger_at_time(target_time, current_ledger):
            """Estimate ledger index at a given time"""
            # Average ~4 seconds per ledger
            seconds_ago = now_ts - target_time
            ledgers_ago = int(seconds_ago / 4)
            return max(1, current_ledger - ledgers_ago)
        
        def get_ledger_total_coins(ledger_index):
            """Get total coins at a specific ledger"""
            result = make_rippled_request("ledger", {"ledger_index": ledger_index})
            if result and 'ledger' in result:
                return int(result['ledger'].get('total_coins', 0))
            return None
        
        def calculate_burn_for_period(start_ledger, end_ledger):
            """Calculate XRP burned between two ledgers"""
            start_coins = get_ledger_total_coins(start_ledger)
            end_coins = get_ledger_total_coins(end_ledger)
            
            if start_coins and end_coins:
                burned_drops = start_coins - end_coins
                return burned_drops / 1_000_000  # Convert to XRP
            return None
        
        # Calculate burns for different periods
        periods = {
            'daily': 1,
            'weekly': 7,
            'monthly': 30,
            'yearly': 365
        }
        
        for period_name, days in periods.items():
            try:
                target_time = now_ts - (days * 86400)
                start_ledger = find_ledger_at_time(target_time, current_ledger_index)
                burned = calculate_burn_for_period(start_ledger, current_ledger_index)
                if burned is not None:
                    burn_data[period_name] = int(burned)
            except Exception as e:
                logging.warning(f"Error calculating {period_name} burn: {e}")
        
        result = {
            'timestamp': now.strftime("%Y-%m-%d %H:%M:%S"),
            'current_supply': current_supply_xrp,
            'total_burned': total_burned_xrp,
            'burns': burn_data,
            'ledger_index': current_ledger_index,
            'cached': False
        }
        
        # Cache result
        burn_cache['data'] = result
        burn_cache['timestamp'] = now
        
        return jsonify(result)
        
    except Exception as e:
        logging.error(f"Burn endpoint error: {e}")
        return jsonify({'error': str(e)}), 500

# =====================================================
# EXISTING API ENDPOINTS
# =====================================================

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
        language = data.get('language', 'en')  # Get language preference
        
        now = datetime.now()
        # Use language-specific cache key
        cache_key = f"analysis_{language}"
        if ai_cache.get(cache_key) and ai_cache.get(f'{cache_key}_timestamp'):
            age = (now - ai_cache[f'{cache_key}_timestamp']).total_seconds()
            if age < ai_cache['cache_duration']:
                return jsonify({'success': True, 'analysis': ai_cache[cache_key], 'cached': True})
        
        # Language instruction
        if language == 'ko':
            lang_instruction = "한국어로 답변해 주세요. (Respond in Korean)"
            section_names = "시장 개요, 기술적 분석, 기관 자금 흐름, 전망"
        else:
            lang_instruction = "Respond in English."
            section_names = "Market Overview, Technical Analysis, Institutional Flow, Outlook"
        
        prompt = f"""Analyze this XRP market data and provide 4 paragraphs: {section_names}.
Price: ${market_data.get('currentPrice', 0):.4f}
24h Change: {market_data.get('priceChange24h', 0):.2f}%
7d Change: {market_data.get('priceChange7d', 0):.2f}%
7-Day MA: ${market_data.get('ma7', 0):.4f}
30-Day MA: ${market_data.get('ma30', 0):.4f}
ETF Holdings: {market_data.get('etfHoldings', 0):,} XRP
Sentiment: {market_data.get('sentimentScore', 50)}/100

{lang_instruction}
Be concise and professional."""

        message = anthropic_client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}]
        )
        analysis = message.content[0].text
        ai_cache[cache_key] = analysis
        ai_cache[f'{cache_key}_timestamp'] = now
        return jsonify({'success': True, 'analysis': analysis, 'cached': False})
    except Exception as e:
        # Try to return cached data for any language
        for lang in ['en', 'ko']:
            cache_key = f"analysis_{lang}"
            if ai_cache.get(cache_key):
                return jsonify({'success': True, 'analysis': ai_cache[cache_key], 'cached': True, 'stale': True})
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
        language = data.get('language', 'en')  # Get language preference
        
        # Language-specific instructions
        if language == 'ko':
            lang_instruction = "한국어로 답변해 주세요. 친근하고 도움이 되게 답변하세요."
            disclaimer = "투자 조언은 전문가와 상담하세요."
        else:
            lang_instruction = "Respond in English."
            disclaimer = "Always consult a financial advisor for investment decisions."
        
        # Build context with market data
        context = f"""You are an XRP market assistant. Be helpful, concise, and friendly. Use emojis occasionally.
{lang_instruction}

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
- {disclaimer}
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
    return jsonify({
        'status': 'healthy', 
        'ai_enabled': anthropic_client is not None,
        'lunarcrush_enabled': LUNARCRUSH_API_KEY is not None
    })

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        'message': 'XRP ETF API',
        'ai_enabled': anthropic_client is not None,
        'lunarcrush_enabled': LUNARCRUSH_API_KEY is not None,
        'endpoints': [
            '/api/etf-data',
            '/api/historical?period=1mo|3mo|6mo|1y',
            '/api/richlist?refresh=false&limit=10000',
            '/api/burn?refresh=false',
            '/api/ai-insights',
            '/api/chat',
            '/api/health',
            '--- LunarCrush Social ---',
            '/api/xrp/all (all data combined)',
            '/api/xrp/topic',
            '/api/xrp/posts',
            '/api/xrp/timeseries',
            '/api/xrp/creators',
            '/api/xrp/news',
            '/api/xrp/coin',
            '/api/xrp/whatsup'
        ]
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
