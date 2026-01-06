import React, { useState, useEffect } from 'react';
import { RefreshCw, TrendingUp, Activity, Calendar, AlertCircle } from 'lucide-react';

const XRPETFDashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [nextUpdate, setNextUpdate] = useState(null);
  const [isMarketHours, setIsMarketHours] = useState(false);
  const [activeTab, setActiveTab] = useState('volumes'); // 'volumes' or 'holdings'

  // Holdings data (initially empty, you'll update daily)
  const [holdingsData, setHoldingsData] = useState([
    {
      date: '1/2/2026',
      canaryXRP: 175547917,
      canaryValue: 319148921.70,
      bitwiseXRP: 135559073.51,
      bitwiseValue: 246367782.25,
      franklinXRP: null,
      franklinValue: null,
      grayscaleXRP: null,
      grayscaleValue: null,
      shares21XRP: null,
      shares21Value: null,
      rexXRP: null,
      rexValue: null,
      nciq: null,
      bitw: null,
      grayscaleGDLC: null,
      franklinEZPZ: null,
      ezpzValue: null
    },
    {
      date: '12/31/2025',
      canaryXRP: 175552727,
      canaryValue: 328418423.11,
      bitwiseXRP: 118387154,
      bitwiseValue: 215197065.61,
      franklinXRP: null,
      franklinValue: null,
      grayscaleXRP: null,
      grayscaleValue: null,
      shares21XRP: null,
      shares21Value: null,
      rexXRP: null,
      rexValue: null,
      nciq: null,
      bitw: null,
      grayscaleGDLC: null,
      franklinEZPZ: null,
      ezpzValue: null
    }
  ]);

  const calculateHoldingsTotals = () => {
    if (!holdingsData || holdingsData.length === 0) return null;
    
    const latest = holdingsData[0];
    let totalXRP = 0;
    let totalValue = 0;
    let activeETFs = 0;
    
    const fields = [
      { xrp: 'canaryXRP', value: 'canaryValue' },
      { xrp: 'bitwiseXRP', value: 'bitwiseValue' },
      { xrp: 'franklinXRP', value: 'franklinValue' },
      { xrp: 'grayscaleXRP', value: 'grayscaleValue' },
      { xrp: 'shares21XRP', value: 'shares21Value' },
      { xrp: 'rexXRP', value: 'rexValue' }
    ];
    
    fields.forEach(field => {
      if (latest[field.xrp]) {
        totalXRP += latest[field.xrp];
        activeETFs++;
      }
      if (latest[field.value]) {
        totalValue += latest[field.value];
      }
    });
    
    const currentPrice = totalXRP > 0 ? totalValue / totalXRP : 1.97;
    
    return {
      totalXRP,
      totalValue,
      currentPrice,
      activeETFs,
      lastUpdated: latest.date
    };
  };

  // Your live backend URL
  const API_URL = 'https://xrp-etf-backend.onrender.com';

  const descriptions = {
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
  };

  const calculateNextUpdate = () => {
    const now = new Date();
    const next = new Date(now.getTime() + 1 * 60 * 1000);
    return next;
  };

  const checkMarketHours = () => {
    const now = new Date();
    const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    
    const day = etTime.getDay();
    const hour = etTime.getHours();
    const minute = etTime.getMinutes();
    
    const isWeekday = day >= 1 && day <= 5;
    const time = hour * 60 + minute;
    const marketOpen = 9 * 60 + 30;
    const marketClose = 16 * 60;
    
    return isWeekday && time >= marketOpen && time < marketClose;
  };

  const fetchLiveData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('Fetching data from:', `${API_URL}/api/etf-data`);
      const response = await fetch(`${API_URL}/api/etf-data`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('Received data:', result);
      
      if (result.data) {
        setData(result.data);
        setLastUpdate(new Date(result.timestamp || new Date()));
        setNextUpdate(calculateNextUpdate());
      } else {
        throw new Error('No data in response');
      }
    } catch (err) {
      setError(err.message);
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchLiveData();
  };

  useEffect(() => {
    // Initial fetch
    fetchLiveData();
    setIsMarketHours(checkMarketHours());

    // Auto-refresh every 1 minute during market hours
    const interval = setInterval(() => {
      const marketOpen = checkMarketHours();
      setIsMarketHours(marketOpen);
      
      if (marketOpen) {
        fetchLiveData();
      }
    }, 1 * 60 * 1000);

    const hourCheck = setInterval(() => {
      setIsMarketHours(checkMarketHours());
    }, 60 * 1000);

    return () => {
      clearInterval(interval);
      clearInterval(hourCheck);
    };
  }, []);

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const ETFCard = ({ groupName, etfs }) => {
    if (!etfs || etfs.length === 0) return null;

    const totals = {
      daily: { shares: 0, dollars: 0 },
      weekly: { shares: 0, dollars: 0 },
      monthly: { shares: 0, dollars: 0 },
      yearly: { shares: 0, dollars: 0 }
    };

    etfs.forEach(etf => {
      if (etf.daily) {
        totals.daily.shares += etf.daily.shares || 0;
        totals.daily.dollars += etf.daily.dollars || 0;
      }
      if (etf.weekly) {
        totals.weekly.shares += etf.weekly.shares || 0;
        totals.weekly.dollars += etf.weekly.dollars || 0;
      }
      if (etf.monthly) {
        totals.monthly.shares += etf.monthly.shares || 0;
        totals.monthly.dollars += etf.monthly.dollars || 0;
      }
      if (etf.yearly) {
        totals.yearly.shares += etf.yearly.shares || 0;
        totals.yearly.dollars += etf.yearly.dollars || 0;
      }
    });

    return (
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-500 pb-2">
          📈 {groupName}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left p-2 font-semibold sticky left-0 bg-gray-100 z-10">Symbol</th>
                <th className="text-right p-2 font-semibold">Price</th>
                <th className="text-right p-2 font-semibold bg-blue-50">Daily Vol (sh)</th>
                <th className="text-right p-2 font-semibold bg-blue-50">Daily Vol ($)</th>
                <th className="text-right p-2 font-semibold bg-green-50">Week Vol (sh)</th>
                <th className="text-right p-2 font-semibold bg-green-50">Week Vol ($)</th>
                <th className="text-right p-2 font-semibold bg-yellow-50">Month Vol (sh)</th>
                <th className="text-right p-2 font-semibold bg-yellow-50">Month Vol ($)</th>
                <th className="text-right p-2 font-semibold bg-purple-50">Year Vol (sh)</th>
                <th className="text-right p-2 font-semibold bg-purple-50">Year Vol ($)</th>
              </tr>
            </thead>
            <tbody>
              {etfs.map((etf, idx) => (
                <tr key={idx} className="border-b hover:bg-gray-50 transition">
                  <td className="p-2 sticky left-0 bg-white z-10">
                    <div>
                      <span className="font-semibold text-blue-600">{etf.symbol}</span>
                      <div className="text-gray-500 text-xs">{descriptions[etf.symbol]}</div>
                    </div>
                  </td>
                  <td className="text-right p-2 font-mono font-semibold">${etf.price?.toFixed(2)}</td>
                  <td className="text-right p-2 font-mono bg-blue-50">{etf.daily?.shares?.toLocaleString() || '-'}</td>
                  <td className="text-right p-2 font-mono text-blue-600 bg-blue-50">${etf.daily?.dollars?.toLocaleString() || '-'}</td>
                  <td className="text-right p-2 font-mono bg-green-50">{etf.weekly?.shares?.toLocaleString() || '-'}</td>
                  <td className="text-right p-2 font-mono text-green-600 bg-green-50">${etf.weekly?.dollars?.toLocaleString() || '-'}</td>
                  <td className="text-right p-2 font-mono bg-yellow-50">{etf.monthly?.shares?.toLocaleString() || '-'}</td>
                  <td className="text-right p-2 font-mono text-yellow-700 bg-yellow-50">${etf.monthly?.dollars?.toLocaleString() || '-'}</td>
                  <td className="text-right p-2 font-mono bg-purple-50">{etf.yearly?.shares?.toLocaleString() || '-'}</td>
                  <td className="text-right p-2 font-mono text-purple-600 bg-purple-50">${etf.yearly?.dollars?.toLocaleString() || '-'}</td>
                </tr>
              ))}
              <tr className="bg-indigo-100 font-bold">
                <td className="p-2 sticky left-0 bg-indigo-100 z-10">{groupName} Total</td>
                <td className="text-right p-2">-</td>
                <td className="text-right p-2 font-mono bg-blue-100">{totals.daily.shares.toLocaleString()}</td>
                <td className="text-right p-2 font-mono text-blue-700 bg-blue-100">${totals.daily.dollars.toLocaleString()}</td>
                <td className="text-right p-2 font-mono bg-green-100">{totals.weekly.shares.toLocaleString()}</td>
                <td className="text-right p-2 font-mono text-green-700 bg-green-100">${totals.weekly.dollars.toLocaleString()}</td>
                <td className="text-right p-2 font-mono bg-yellow-100">{totals.monthly.shares.toLocaleString()}</td>
                <td className="text-right p-2 font-mono text-yellow-800 bg-yellow-100">${totals.monthly.dollars.toLocaleString()}</td>
                <td className="text-right p-2 font-mono bg-purple-100">{totals.yearly.shares.toLocaleString()}</td>
                <td className="text-right p-2 font-mono text-purple-700 bg-purple-100">${totals.yearly.dollars.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const calculateGrandTotals = () => {
    if (!data) return null;

    const totals = {
      daily: { shares: 0, dollars: 0 },
      weekly: { shares: 0, dollars: 0 },
      monthly: { shares: 0, dollars: 0 },
      yearly: { shares: 0, dollars: 0 }
    };

    Object.values(data).flat().forEach(etf => {
      if (etf.daily) {
        totals.daily.shares += etf.daily.shares || 0;
        totals.daily.dollars += etf.daily.dollars || 0;
      }
      if (etf.weekly) {
        totals.weekly.shares += etf.weekly.shares || 0;
        totals.weekly.dollars += etf.weekly.dollars || 0;
      }
      if (etf.monthly) {
        totals.monthly.shares += etf.monthly.shares || 0;
        totals.monthly.dollars += etf.monthly.dollars || 0;
      }
      if (etf.yearly) {
        totals.yearly.shares += etf.yearly.shares || 0;
        totals.yearly.dollars += etf.yearly.dollars || 0;
      }
    });

    return totals;
  };

  const grandTotals = calculateGrandTotals();

  const HoldingsTab = ({ holdingsData, calculateHoldingsTotals }) => {
    const totals = calculateHoldingsTotals();
    
    if (!totals) return null;

    return (
      <div>
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-500 text-sm mb-1">Total XRP</p>
            <p className="text-2xl font-bold text-blue-600">{totals.totalXRP.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-500 text-sm mb-1">Total Value</p>
            <p className="text-2xl font-bold text-green-600">${totals.totalValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-500 text-sm mb-1">Current XRP Price</p>
            <p className="text-2xl font-bold text-purple-600">${totals.currentPrice.toFixed(4)}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-500 text-sm mb-1">Active ETFs</p>
            <p className="text-2xl font-bold text-indigo-600">{totals.activeETFs}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-500 text-sm mb-1">Last Updated</p>
            <p className="text-2xl font-bold text-gray-700">{totals.lastUpdated}</p>
          </div>
        </div>

        {/* Holdings Table */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-500 pb-2">
            📊 Daily Holdings Data
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-100">
                  <th className="text-left p-2 font-semibold sticky left-0 bg-gray-100 z-10">Date</th>
                  <th className="text-right p-2 font-semibold">Canary XRP</th>
                  <th className="text-right p-2 font-semibold">Canary Value</th>
                  <th className="text-right p-2 font-semibold">Bitwise XRP</th>
                  <th className="text-right p-2 font-semibold">Bitwise Value</th>
                  <th className="text-right p-2 font-semibold">Franklin XRP</th>
                  <th className="text-right p-2 font-semibold">Franklin Value</th>
                  <th className="text-right p-2 font-semibold">Grayscale XRP</th>
                  <th className="text-right p-2 font-semibold">Grayscale Value</th>
                  <th className="text-right p-2 font-semibold">21Shares XRP</th>
                  <th className="text-right p-2 font-semibold">21Shares Value</th>
                  <th className="text-right p-2 font-semibold">Rex Shares</th>
                  <th className="text-right p-2 font-semibold">Rex Value</th>
                </tr>
              </thead>
              <tbody>
                {holdingsData.map((row, idx) => (
                  <tr key={idx} className="border-b hover:bg-gray-50">
                    <td className="p-2 font-semibold sticky left-0 bg-white z-10">{row.date}</td>
                    <td className="text-right p-2 font-mono">{row.canaryXRP ? row.canaryXRP.toLocaleString() : '—'}</td>
                    <td className="text-right p-2 font-mono text-green-600">{row.canaryValue ? `$${row.canaryValue.toLocaleString(undefined, {minimumFractionDigits: 2})}` : '—'}</td>
                    <td className="text-right p-2 font-mono">{row.bitwiseXRP ? row.bitwiseXRP.toLocaleString() : '—'}</td>
                    <td className="text-right p-2 font-mono text-green-600">{row.bitwiseValue ? `$${row.bitwiseValue.toLocaleString(undefined, {minimumFractionDigits: 2})}` : '—'}</td>
                    <td className="text-right p-2 font-mono">{row.franklinXRP ? row.franklinXRP.toLocaleString() : '—'}</td>
                    <td className="text-right p-2 font-mono text-green-600">{row.franklinValue ? `$${row.franklinValue.toLocaleString(undefined, {minimumFractionDigits: 2})}` : '—'}</td>
                    <td className="text-right p-2 font-mono">{row.grayscaleXRP ? row.grayscaleXRP.toLocaleString() : '—'}</td>
                    <td className="text-right p-2 font-mono text-green-600">{row.grayscaleValue ? `$${row.grayscaleValue.toLocaleString(undefined, {minimumFractionDigits: 2})}` : '—'}</td>
                    <td className="text-right p-2 font-mono">{row.shares21XRP ? row.shares21XRP.toLocaleString() : '—'}</td>
                    <td className="text-right p-2 font-mono text-green-600">{row.shares21Value ? `$${row.shares21Value.toLocaleString(undefined, {minimumFractionDigits: 2})}` : '—'}</td>
                    <td className="text-right p-2 font-mono">{row.rexXRP ? row.rexXRP.toLocaleString() : '—'}</td>
                    <td className="text-right p-2 font-mono text-green-600">{row.rexValue ? `$${row.rexValue.toLocaleString(undefined, {minimumFractionDigits: 2})}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="mt-4 p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-gray-700">
              💡 <strong>Note:</strong> To update holdings data, you'll need to manually edit the holdingsData array in the code with new daily values.
            </p>
          </div>
        </div>
      </div>
    );
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-16 h-16 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-xl text-gray-700">Loading live ETF data...</p>
          <p className="text-sm text-gray-500 mt-2">Fetching from backend...</p>
          <p className="text-xs text-gray-400 mt-1">First load may take 30-60 seconds (Render free tier)</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Connection Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <p className="text-sm text-gray-500 mb-4">
            Backend URL: {API_URL}
          </p>
          <button 
            onClick={handleRefresh}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-full mx-auto">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg shadow-xl p-6 mb-6 text-white">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold mb-2">⭐ XRP ETF Trading Dashboard ⭐</h1>
              <p className="text-blue-100">🚨 Live data from Yahoo Finance via Backend API 🚨</p>
              <p className="text-sm text-blue-200 mt-2">Data Fetched: {formatDate(lastUpdate)} at {formatTime(lastUpdate)}</p>
            </div>
            <button 
              onClick={handleRefresh}
              disabled={loading}
              className="bg-white text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-50 transition disabled:opacity-50 flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          
          {/* Tab Navigation */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setActiveTab('volumes')}
              className={`px-4 py-2 rounded-lg transition ${
                activeTab === 'volumes'
                  ? 'bg-white text-blue-600 font-semibold'
                  : 'bg-blue-500 text-white hover:bg-blue-400'
              }`}
            >
              📊 Trading Volumes
            </button>
            <button
              onClick={() => setActiveTab('holdings')}
              className={`px-4 py-2 rounded-lg transition ${
                activeTab === 'holdings'
                  ? 'bg-white text-blue-600 font-semibold'
                  : 'bg-blue-500 text-white hover:bg-blue-400'
              }`}
            >
              💎 XRP Holdings
            </button>
          </div>
        </div>

        {activeTab === 'volumes' ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-sm">Last Updated</p>
                    <p className="text-lg font-semibold">{formatTime(lastUpdate)}</p>
                    <p className="text-xs text-gray-400">{formatDate(lastUpdate)}</p>
                  </div>
                  <RefreshCw className="w-8 h-8 text-blue-500" />
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-sm">Market Status</p>
                    <p className="text-lg font-semibold">
                      {isMarketHours ? (
                        <span className="text-green-600">● Open</span>
                      ) : (
                        <span className="text-red-600">● Closed</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {isMarketHours ? 'Auto-refresh active' : 'Updates paused'}
                    </p>
                  </div>
                  <Activity className="w-8 h-8 text-green-500" />
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-sm">Next Update</p>
                    <p className="text-lg font-semibold">
                      {isMarketHours && nextUpdate ? formatTime(nextUpdate) : 'N/A'}
                    </p>
                    <p className="text-xs text-gray-400">1-minute intervals</p>
                  </div>
                  <Calendar className="w-8 h-8 text-in
