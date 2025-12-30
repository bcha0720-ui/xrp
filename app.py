from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime, timedelta
import logging
import time

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)

# Cache to store data and avoid rate limits
cache = {
    'data': None,
    'timestamp': None,
    'cache_duration': 300  # 5 minutes cache
}

groups = {
    "Index ETFs": ['EZPZ', 'GDLC', 'NCIQ', 'BITW'],
    "Spot ETFs": ['GXRP', 'XRP', 'XRPC', 'XRPZ', 'TOXR', 'XRPR'],
    "Futures ETFs": ['UXRP', 'XRPI', 'XRPM', 'XRPT', 'XXRP', 'XRPK'],
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

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        'cache_valid': cache['data'] is not None
    })

@app.route('/api/clear-cache', methods=['GET'])
def clear_cache():
    """Clear the cache to force fresh data"""
    cache['data'] = None
    cache['timestamp'] = None
    return jsonify({'message': 'Cache cleared'})

@app.route('/', methods=['GET'])
def home():
    """Home endpoint with API info"""
    return jsonify({
        'message': 'XRP ETF API',
        'endpoints': {
            '/api/etf-data': 'Get all ETF data (cached 5 min)',
            '/api/health': 'Health check',
            '/api/clear-cache': 'Clear cache'
        }
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
