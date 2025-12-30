from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime
import logging

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend to access

logging.basicConfig(level=logging.INFO)

groups = {
    "Index ETFs": ['EZPZ', 'GDLC', 'NCIQ', 'BITW'],
    "Spot ETFs": ['GXRP', 'XRP', 'XRPC', 'XRPZ', 'TOXR', 'XRPR'],
    "Futures ETFs": ['UXRP', 'XRPI', 'XRPM', 'XRPT', 'XXRP', 'XRPK'],
    "Canada ETFs": ['XRP.TO', 'XRPP-B.TO', 'XRPP-U.TO', 'XRPP.TO', 
                    'XRPQ-U.TO', 'XRPQ.TO', 'XRP.NE', 'XRPP.NE', 'RPQ.NE']
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
    'XRPP.NE': 'Purpose NEO',
    'RPQ.NE': 'RPQ NEO'
}

def fetch_etf_data():
    """Fetch all ETF data from yfinance"""
    data = {}
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    for group_name, symbols in groups.items():
        data[group_name] = []
        
        for symbol in symbols:
            try:
                ticker = yf.Ticker(symbol)
                info = ticker.info
                price = info.get('regularMarketPrice') or info.get('currentPrice')
                volume = info.get('regularMarketVolume') or info.get('volume')
                
                if price and volume:
                    etf_data = {
                        'symbol': symbol,
                        'price': round(price, 2),
                        'daily': {
                            'shares': volume,
                            'dollars': int(price * volume)
                        }
                    }
                    
                    # Weekly data (last 5 trading days)
                    hist_week = ticker.history(period="5d")
                    if not hist_week.empty:
                        volume_week = int(hist_week['Volume'].sum())
                        dollar_week = int((hist_week['Close'] * hist_week['Volume']).sum())
                        etf_data['weekly'] = {
                            'shares': volume_week,
                            'dollars': dollar_week
                        }
                    
                    # Monthly data
                    hist_month = ticker.history(period="1mo")
                    if not hist_month.empty:
                        volume_month = int(hist_month['Volume'].sum())
                        dollar_month = int((hist_month['Close'] * hist_month['Volume']).sum())
                        etf_data['monthly'] = {
                            'shares': volume_month,
                            'dollars': dollar_month
                        }
                    
                    # Yearly data
                    hist_year = ticker.history(period="1y")
                    if not hist_year.empty:
                        volume_year = int(hist_year['Volume'].sum())
                        dollar_year = int((hist_year['Close'] * hist_year['Volume']).sum())
                        etf_data['yearly'] = {
                            'shares': volume_year,
                            'dollars': dollar_year
                        }
                    
                    data[group_name].append(etf_data)
                    logging.info(f"Successfully fetched data for {symbol}")
                else:
                    logging.warning(f"No current data for {symbol}")
                    
            except Exception as e:
                logging.error(f"Error fetching {symbol}: {e}")
    
    return {
        'timestamp': timestamp,
        'data': data
    }

@app.route('/api/etf-data', methods=['GET'])
def get_etf_data():
    """API endpoint to get all ETF data"""
    try:
        result = fetch_etf_data()
        return jsonify(result)
    except Exception as e:
        logging.error(f"API Error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })

@app.route('/', methods=['GET'])
def home():
    """Home endpoint with API info"""
    return jsonify({
        'message': 'XRP ETF API',
        'endpoints': {
            '/api/etf-data': 'Get all ETF data',
            '/api/health': 'Health check'
        }
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
