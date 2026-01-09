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

# Caches
ai_cache = {'data': None, 'timestamp': None, 'cache_duration': 300}
cache = {'data': None, 'timestamp': None, 'cache_duration': 300}
historical_cache = {'data': None, 'timestamp': None, 'cache_duration': 600}  # 10 min cache for historical
richlist_cache = {'data': None, 'timestamp': None, 'cache_duration': 86400}  # 24 hour cache for rich list
burn_cache = {'data': None, 'timestamp': None, 'cache_duration': 3600}  # 1 hour cache for burn data

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
                
                # Check if symbol exists in data
                if symbol in hist.columns.get_level_values(0):
                    sym_hist = hist[symbol]
                    
                    if sym_hist.empty:
                        continue
                    
                    # Iterate through each day
                    for date, row in sym_hist.iterrows():
                        try:
                            close_price = row.get('Close')
                            volume = row.get('Volume')
                            
                            # Skip if no valid data
                            if close_price is None or (hasattr(close_price, '__iter__') and len(close_price) == 0):
                                continue
                            
                            # Handle potential series/array values
                            if hasattr(close_price, 'item'):
                                close_price = close_price.item()
                            if hasattr(volume, 'item'):
                                volume = volume.item()
                            
                            # Skip NaN values
                            if close_price != close_price:  # NaN check
                                continue
                            
                            symbol_data.append({
                                'date': date.strftime('%Y-%m-%d'),
                                'price': round(float(close_price), 2),
                                'volume': int(volume) if volume == volume else 0  # NaN check for volume
                            })
                        except Exception as e:
                            logging.warning(f"Error processing row for {symbol}: {e}")
                            continue
                    
                    if symbol_data:
                        data[symbol] = symbol_data
                        logging.info(f"Got {len(symbol_data)} data points for {symbol}")
                        
            except Exception as e:
                errors.append(f"{symbol}: {str(e)}")
                logging.warning(f"Error fetching {symbol}: {e}")
                
    except Exception as e:
        errors.append(f"Batch error: {str(e)}")
        logging.error(f"Historical fetch error: {e}")
    
    return {
        'data': data,
        'period': period,
        'symbols': list(data.keys()),
        'errors': errors if errors else None
    }

@app.route('/api/historical', methods=['GET'])
def get_historical():
    """
    Get historical price/volume data for XRP Spot ETFs
    Query params:
        - period: 1mo, 3mo, 6mo, 1y (default: 1mo)
    """
    try:
        period = request.args.get('period', '1mo')
        
        # Validate period
        valid_periods = ['1mo', '3mo', '6mo', '1y']
        if period not in valid_periods:
            period = '1mo'
        
        # Check cache
        cache_key = f"historical_{period}"
        now = datetime.now()
        
        if (historical_cache.get('key') == cache_key and 
            historical_cache['data'] and 
            historical_cache['timestamp']):
            age = (now - historical_cache['timestamp']).total_seconds()
            if age < historical_cache['cache_duration']:
                result = historical_cache['data'].copy()
                result['cached'] = True
                result['cache_age'] = int(age)
                logging.info(f"Returning cached historical data (age: {int(age)}s)")
                return jsonify(result)
        
        # Fetch fresh data
        result = fetch_historical_data(period)
        
        # Cache if we got data
        if result['data']:
            historical_cache['data'] = result
            historical_cache['timestamp'] = now
            historical_cache['key'] = cache_key
        
        result['cached'] = False
        return jsonify(result)
        
    except Exception as e:
        logging.error(f"Historical endpoint error: {e}")
        return jsonify({'error': str(e), 'data': {}}), 500

# =====================================================
# RICH LIST (TOP 10K) ENDPOINT
# =====================================================

# Known wallet labels
KNOWN_ADDRESSES = {
    "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh": "Binance",
    "rPz2qA93PeRCyHyFCqyNggnyycJR1N4iNf": "Binance",
    "rPJ5GFpyDLv7gqeB1uZVUBwDwi41kaXN5A": "Binance",
    "rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh": "Uphold",
    "rUeDDFNp2q7Ymvyv75hFGC8DAcygVyJbNF": "Uphold",
    "rp7TCczQuQo61dUo1oAgwdpRxLrA8vDaNV": "Uphold",
    "rNRc2S2GSefSkTkAiyjE6LDzMonpeHp6jS": "Bitso",
    "raQxZLtqurEXvH5sgijrif7yXMNwvFRkJN": "Kraken",
    "rMvCasZ9cohYrSZRNYPTZfoaaSUQMfgQ8G": "Bitstamp",
    "rwBHqnCgNRnk3Kyoc6zon6Wt4Wujj3HNGe": "Coinbase",
    "rEAKseZ7yNgaDuxH74PkqB12cVWohpi7R6": "Robinhood",
    "r4ZuQtPNXGRMKfPjAsn2J7gRqoQuWnTPFP": "Robinhood",
    "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv": "Bitstamp",
    "rLW9gnQo7BQhU6igk5keqYnH3TVrCxGRzm": "Bitfinex",
    "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq": "GateHub",
    "rHWcuuZoFvDS6gNbmHSdpb7u1hZzxvCoMt": "GateHub",
    "rKq7xLeTaDFCg9cdy9MmgxpPWS8EZf2fNq": "Bitrue",
    "rPMM1dRp7taeRkbT74Smx2a25kTAHdr4N5": "Bithumb",
    "rGDreBvnHrX1get7na3J4oowN19ny4GzFn": "Bitget",
    "rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9": "Ripple",
    "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh": "Genesis",
}

def fetch_account_balance(address):
    """Fetch balance for a single account from XRPL"""
    for url in RIPPLED_URLS:
        try:
            response = requests.post(url, json={
                "method": "account_info",
                "params": [{
                    "account": address,
                    "ledger_index": "validated",
                    "strict": True
                }]
            }, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if 'result' in data and 'account_data' in data['result']:
                    balance_drops = int(data['result']['account_data']['Balance'])
                    return balance_drops / 1000000  # Convert drops to XRP
        except Exception as e:
            logging.warning(f"Error fetching {address} from {url}: {e}")
            continue
    return None

def fetch_richlist_from_xrpscan():
    """Fetch rich list from XRPScan API"""
    try:
        response = requests.get(f"{XRPSCAN_BASE}/richlist", timeout=30)
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list) and len(data) > 0:
                return data
        return None
    except Exception as e:
        logging.error(f"XRPScan richlist error: {e}")
        return None

def calculate_richlist_stats(accounts):
    """Calculate statistics for the rich list"""
    if not accounts:
        return {}
    
    balances = [a['balance'] for a in accounts]
    total = sum(balances)
    count = len(balances)
    
    sorted_balances = sorted(balances)
    median = sorted_balances[count // 2] if count > 0 else 0
    mean = total / count if count > 0 else 0
    
    # Count whales (>=1M XRP)
    whale_count = sum(1 for b in balances if b >= 1000000)
    
    # Gini coefficient
    gini = 0
    if count > 0 and total > 0:
        cumulative = 0
        for i, b in enumerate(sorted_balances):
            cumulative += b
            gini += (2 * (i + 1) - count - 1) * b
        gini = gini / (count * total)
    
    return {
        'total_xrp': total,
        'account_count': count,
        'whale_count': whale_count,
        'mean_balance': mean,
        'median_balance': median,
        'gini_coefficient': round(gini, 4)
    }

@app.route('/api/richlist', methods=['GET'])
def get_richlist():
    """
    Get top 10K XRP rich list
    Query params:
        - refresh: true to force refresh (bypasses cache)
        - limit: number of accounts to return (default 10000, max 10000)
    """
    try:
        force_refresh = request.args.get('refresh', 'false').lower() == 'true'
        limit = min(int(request.args.get('limit', 10000)), 10000)
        
        now = datetime.now()
        
        # Check cache unless force refresh
        if not force_refresh and richlist_cache['data'] and richlist_cache['timestamp']:
            age = (now - richlist_cache['timestamp']).total_seconds()
            if age < richlist_cache['cache_duration']:
                result = richlist_cache['data'].copy()
                result['cached'] = True
                result['cache_age'] = int(age)
                result['accounts'] = result['accounts'][:limit]
                logging.info(f"Returning cached richlist (age: {int(age)}s)")
                return jsonify(result)
        
        logging.info("Fetching fresh rich list data...")
        
        # Try XRPScan first
        xrpscan_data = fetch_richlist_from_xrpscan()
        
        accounts = []
        if xrpscan_data:
            for i, item in enumerate(xrpscan_data[:10000]):
                address = item.get('account') or item.get('address', '')
                balance = float(item.get('balance', 0))
                accounts.append({
                    'rank': i + 1,
                    'address': address,
                    'balance': balance,
                    'name': KNOWN_ADDRESSES.get(address, item.get('name', 'Unknown'))
                })
        
        if not accounts:
            # Fallback: Return error
            return jsonify({
                'error': 'Unable to fetch rich list data',
                'accounts': [],
                'stats': {}
            }), 503
        
        # Calculate stats
        stats = calculate_richlist_stats(accounts)
        
        result = {
            'timestamp': now.strftime("%Y-%m-%d %H:%M:%S"),
            'accounts': accounts,
            'stats': stats,
            'cached': False
        }
        
        # Cache the result
        richlist_cache['data'] = result
        richlist_cache['timestamp'] = now
        
        # Return with limit applied
        result['accounts'] = accounts[:limit]
        
        return jsonify(result)
        
    except Exception as e:
        logging.error(f"Richlist endpoint error: {e}")
        return jsonify({'error': str(e), 'accounts': [], 'stats': {}}), 500

# =====================================================
# BURN TRACKER ENDPOINT
# =====================================================

def get_ledger_data(ledger_index):
    """Fetch ledger data from XRPScan"""
    try:
        response = requests.get(f"{XRPSCAN_BASE}/ledger/{ledger_index}", timeout=10)
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        logging.warning(f"Error fetching ledger {ledger_index}: {e}")
    return None

def get_current_ledger():
    """Get current ledger info"""
    try:
        response = requests.get(f"{XRPSCAN_BASE}/ledgers", timeout=10)
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        logging.warning(f"Error fetching current ledger: {e}")
    return None

def find_ledger_at_time(target_timestamp, current_ledger_index):
    """Binary search to find ledger at specific timestamp"""
    low = 32570  # Approximate starting ledger
    high = current_ledger_index
    
    while low < high:
        mid = (low + high) // 2
        ledger = get_ledger_data(mid)
        if not ledger:
            break
        
        close_time = ledger.get('close_time', 0)
        if close_time < target_timestamp:
            low = mid + 1
        else:
            high = mid
    
    return low

def calculate_burn_for_period(start_ledger_index, end_ledger_index):
    """Calculate XRP burned between two ledgers"""
    start_ledger = get_ledger_data(start_ledger_index)
    end_ledger = get_ledger_data(end_ledger_index)
    
    if not start_ledger or not end_ledger:
        return None
    
    start_total = int(start_ledger.get('total_coins', 0))
    end_total = int(end_ledger.get('total_coins', 0))
    
    burned_drops = start_total - end_total
    burned_xrp = burned_drops / 1000000
    
    return burned_xrp

@app.route('/api/burn', methods=['GET'])
def get_burn_data():
    """
    Get XRP burn statistics
    Query params:
        - refresh: true to force refresh
    """
    try:
        force_refresh = request.args.get('refresh', 'false').lower() == 'true'
        now = datetime.now()
        
        # Check cache
        if not force_refresh and burn_cache['data'] and burn_cache['timestamp']:
            age = (now - burn_cache['timestamp']).total_seconds()
            if age < burn_cache['cache_duration']:
                result = burn_cache['data'].copy()
                result['cached'] = True
                result['cache_age'] = int(age)
                return jsonify(result)
        
        logging.info("Fetching fresh burn data...")
        
        # Get current ledger info
        current_ledger_info = get_current_ledger()
        if not current_ledger_info:
            return jsonify({'error': 'Unable to fetch ledger data'}), 503
        
        current_ledger_index = current_ledger_info.get('current_ledger', 0)
        current_total_drops = int(current_ledger_info.get('total_coins', 0))
        
        # Initial supply: 100 billion XRP in drops
        initial_drops = 100000000000000000
        
        # Calculate total burned
        total_burned_drops = initial_drops - current_total_drops
        total_burned_xrp = total_burned_drops / 1000000
        current_supply_xrp = current_total_drops / 1000000
        
        # Calculate periodic burns
        now_ts = time.time()
        
        burn_data = {
            'daily': None,
            'weekly': None,
            'monthly': None,
            'yearly': None
        }
        
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
    return jsonify({'status': 'healthy', 'ai_enabled': anthropic_client is not None})

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        'message': 'XRP ETF API',
        'ai_enabled': anthropic_client is not None,
        'endpoints': [
            '/api/etf-data',
            '/api/historical?period=1mo|3mo|6mo|1y',
            '/api/richlist?refresh=false&limit=10000',
            '/api/burn?refresh=false',
            '/api/ai-insights',
            '/api/chat',
            '/api/health'
        ]
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
