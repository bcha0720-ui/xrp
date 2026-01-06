"""
XRP Exchange Holdings Dashboard - Enhanced Version
Interactive Streamlit dashboard with async fetching, auto-refresh, and improved UI
"""

import streamlit as st
import streamlit.components.v1 as components
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import requests
import asyncio
import aiohttp
import time
from datetime import datetime
from typing import Dict, Optional
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

# ============================================================================
# PAGE CONFIG (must be first)
# ============================================================================

st.set_page_config(
    page_title="XRP Exchange Holdings Tracker",
    page_icon="💎",
    layout="wide",
    initial_sidebar_state="expanded"
)

# ============================================================================
# CONFIGURATION
# ============================================================================

RIPPLED_URLS = [
    "https://s1.ripple.com:51234",
    "https://s2.ripple.com:51234",
    "https://xrplcluster.com",
]
MAX_RETRIES = 2
REQUEST_TIMEOUT = 8
MAX_WORKERS = 20  # Concurrent requests

# ============================================================================
# HISTORICAL DATA - February 24, 2025 Benchmark
# ============================================================================

HISTORICAL_BALANCES_20250224 = {
    "r38a3PtqW3M7LRESgaR4dyHjg3AxAmiZCt": 500000022.920354,
    "r4G689g4KePYLKkyyumM1iUppTP4nhZwVC": 500000023.954709,
    "rDxJNbV23mu9xsWoQHoBqZQvc77YcbJXwb": 980472688.335846,
    "rHHQeqjz2QyNj1DVoAbcvfaKLv7RxpHMNE": 427.863089,
    "rJWbw1u3oDDRcYLFqiWFjhGWRKVcBAWdgp": 500000022.940415,
    "rJo4m69u9Wd1F8fN2RbgAsJEF6a4hW1nSi": 500000022.974330,
    "rLgn612WAgRoZ285YmsQ4t7kb8Ui3csdoU": 500000022.970497,
    "rMNUAfSz2spLEbaBwPnGtxTzZCajJifnzH": 500000022.930304,
    "rNcAdhSLXBrJ3aZUq22HaNtNEPpB5fR8Ri": 500000070.927547,
    "raQwCVAJVqjrVm1Nj5SFRcX8i22BhdC9WA": 5380330.943804,
    "rfL1mn4VTCoHdhHhHMwqpShCFUaDBRk6Z5": 500000113.144652,
    "rs48xReB6gjKtTnTfii93iwUhjhTJsW78B": 500000022.951598,
    "rwa7YXssGVAL9yPKw6QJtCen2UqZbRQqpM": 500000111.032735,
    "r3ZVNKgkkT3A7hbEZ8HxnNnLDCCmZiZECV": 4319156.176484,
    "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh": 7375.223257,
    "rEeEWeP88cpKUddKk37B2EZeiHBGiBXY3": 122.800031,
    "rMvYS27SYs5dXdFsUgpvv1CSrPsCz7ePF5": 219728.667554,
    "rNU4eAowPuixS5ZCWaRL72UUeKgxcKExpK": 6152514.319652,
    "rNxp4h8apvRis6mJf9Sh8C6iRxfrDWN7AV": 268204.837425,
    "rPCpZwPKogNodbjRxGDnefVXu9Q9R4PN4Q": 593.363378,
    "rPJ5GFpyDLv7gqeB1uZVUBwDwi41kaXN5A": 109917943.727643,
    "rPz2qA93PeRCyHyFCqyNggnyycJR1N4iNf": 661827727.919798,
    "rhWj9gaovwu2hZxYW7p388P8GRbuXFLQkK": 4831865.223177,
    "rGZjPjMkfhAqmc1ssEiT753uAgyftHRo2m": 20.251542,
    "rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh": 25860812.904039,
    "rUeDDFNp2q7Ymvyv75hFGC8DAcygVyJbNF": 265582363.149146,
    "rp7TCczQuQo61dUo1oAgwdpRxLrA8vDaNV": 290523350.512168,
    "rJn2zAPdFA193sixJwuFixRkYDUtx3apQh": 4653377.535326,
    "rMrgNBrkE6FdCjWih5VAWkGMrmerrWpiZt": 9.757080,
    "rMvCasZ9cohYrSZRNYPTZfoaaSUQMfgQ8G": 116576792.538589,
    "rNFKfGBzMspdKfaZdpnEyhkFyw7C1mtQ8x": 20.965423,
    "raQxZLtqurEXvH5sgijrif7yXMNwvFRkJN": 147378587.843680,
    "rwBHqnCgNRnk3Kyoc6zon6Wt4Wujj3HNGe": 57941994.752545,
    "r39uEuRjzLaSgvkjTfcejodbSrXLM3cYnX": 293.297424,
    "rDDyH5nfvozKZQCwiBrWfcE528sWsBPWET": 2639.366730,
    "rKcVYzVK1f4PhRFjLhWP7QmteG5FpPgRub": 36.929646,
    "rNRc2S2GSefSkTkAiyjE6LDzMonpeHp6jS": 318277941.998112,
    "rUaESVd1yLMy5VyoJvwwuqE8ZiCb2PEqBR": 1123.897979,
    "raSZXZApFg7Nj1B5G6BnhoL6HcTqVMopJ3": 79576.400141,
}

HISTORICAL_DATE = "Feb 24, 2025"

# ============================================================================
# EXCHANGE DEFINITIONS (condensed for brevity - same as original)
# ============================================================================

EXCHANGES = {
     "robinhood": {
        "rEAKseZ7yNgaDuxH74PkqB12cVWohpi7R6": "Robinhood1",
        "r4ZuQtPNXGRMKfPjAsn2J7gRqoQuWnTPFP": "Robinhood2"
    },
    "bitflyer": {
        "rpY7bZBkA98P8zds5LdBktAKj9ifekPdkE": "BitFlyer 3",
        "rhWVCsCXrkwTeLBg6DyDr7abDaHz3zAKmn": "BitFlyer 4"
    },
    "bitpoint": {
        "rwPbLSqTDYwvCsGZEzDTNo3SgzCwEjQdWZ": "BitPoint 1",
        "rfmMjAXq65hpAxEf1RLNQq6RgYTSVkQUW5": "BitPoint 2"
    },
    "bitget": {
        "rGDreBvnHrX1get7na3J4oowN19ny4GzFn": "Bitget Global"
    },
    "bitso": {
        "rLSn6Z3T8uCxbcd1oxwfGQN1Fdn5CyGujK": "Bitso 3"
    },
    "binance": {
        "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh": "Binance 1",
        "rNU4eAowPuixS5ZCWaRL72UUeKgxcKExpK": "Binance 10",
        "rNxp4h8apvRis6mJf9Sh8C6iRxfrDWN7AV": "Binance 11",
        "rPJ5GFpyDLv7gqeB1uZVUBwDwi41kaXN5A": "Binance 12",
        "rPz2qA93PeRCyHyFCqyNggnyycJR1N4iNf": "Binance 13",
        "rhWj9gaovwu2hZxYW7p388P8GRbuXFLQkK": "Binance 14",
        "rarG6FaeYhnzSKSS5EEPofo4gFsPn2bZKk": "Binance 15",
        "rs8ZPbYqgecRcDzQpJYAMhSxSi5htsjnza": "Binance 5",
        "rDAE53VfMvftPB4ogpWGWvzkQxfht6JPxr": "Binance 6",
        "rfQ9EcLkU6WnNmkS3EwUkFeXeN47Rk8Cvi": "Binance 18",
        "rBtttd61FExHC68vsZ8dqmS3DfjFEceA1A": "Binance 9",
        "rLoqMgpjwGEQinYEM623za8c2nC2Uah8v7": "Binance 21",
        "rQUp2PKzH3vCtKs5H9tsPPE1rTsN6fhjqn": "Binance 22",
        "rEeEWeP88cpKUddKk37B2EZeiHBGiBXY3": "Binance US 1",
        "rMvYS27SYs5dXdFsUgpvv1CSrPsCz7ePF5": "Binance US 2",
        "r3ZVNKgkkT3A7hbEZ8HxnNnLDCCmZiZECV": "Binance US 3",
        "rPCpZwPKogNodbjRxGDnefVXu9Q9R4PN4Q": "Binance US 4",
        "rP3mUZyCDzZkTSd1VHoBbFt8HGm8fyq8qV": "Binance 17",
        "rDecw8UhrZZUiaWc91e571b3TL41MUioh7": "Binance 16",
        "rJpj1Mv21gJzsbsVnkp1U4nqchZbmZ9pM5": "Binance (XRP-BF2 Reserve)",
        "rfxbaKNt5SnMw5rPRRm4C53YK76MEnVXro": "Binance Charity2"
    },
    "bitpanda": {
        "rUEfYyerfok6Yo38tTTTZKeRefNh9iB1Bd": "Bitpanda1",
        "rhVWrjB9EGDeK4zuJ1x2KXSjjSpsDQSaU6": "Bitpanda2",
        "r3T75fuLjX51mmfb5Sk1kMNuhBgBPJsjza": "Bitpanda3",
        "rbrCJQZVk6jYra1MPuSvX3Vpe4to9fAvh":  "Bitpanda4"
    },

    "bitstamp": {
        "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv": "Bitstamp1",
        "rUobSiUpYH2S97Mgb4E7b7HuzQj2uzZ3aD": "Bitstamp2",
        "rBMFF7vhe2pxYS5wo3dpXMDrbbRudB7hGf": "Bitstamp3",
        "rEXmdJZRfjXN3XGVdz99dGSZpQyJqUeirE": "Bitstamp"
    },
    "bitbank": {
        "rLbKbPyuvs4wc1h13BEPHgbFGsRXMeFGL6": "Bitbank1",
        "rw7m3CtVHwGSdhFjV4MyJozmZJv3DYQnsA": "Bitbank2",
        "rwggnsfxvCmDb3YP9Hs1TaGvrPR7ngrn7Z": "Bitbank3",
        "r97KeayHuEsDwyU1yPBVtMLLoQr79QcRFe": "Bitbank4"
    },
    "bitfinex": {
        "rLW9gnQo7BQhU6igk5keqYnH3TVrCxGRzm": "Bitfinex1",
        "rE3hWEGquaixF2XwirNbA1ds4m55LxNZPk": "Bitfinex2"
    },
    "bitrue": {
        "rKq7xLeTaDFCg9cdy9MmgxpPWS8EZf2fNq": "Bitrue1",
        "raLPjTYeGezfdb6crXZzcC8RkLBEwbBHJ5": "Bitrue2",
        "rfKsmLP6sTfVGDvga6rW6XbmSFUzc3G9f3": "Bitrue3",
        "rNYW2bie6KwUSYhhtcnXWzRy5nLCa1UNCn": "Bitrue Insurance Fund",
        "r4DbbWjsZQ2hCcxmjncr7MRjpXTBPckGa9": "Bitrue Cold2"
    },
    "bithumb": {
        "rPMM1dRp7taeRkbT74Smx2a25kTAHdr4N5": "Bithumb1",
        "rNTkgxs5WG5mU5Sz26YoDVrHim5Y5ohC7": "Bithumb2",
        "r9hUMZBc3MWRc4YdsdZgNCW5Qef8wNSXpb": "Bithumb3",
        "r9LHiNDZvpLoWPoKnbH2JWjFET8zoYT4Y5": "Bithumb4",
        "rD7XQw67JWBXuo2WPX2gZRsGKNsDUGTbx5": "Bithumb",
        "rZcBQae9iSJqFYBpNCfxGLXH7xuEzizxR": "Bithumb10",
        "rrsSUzrT2mYAMiL46pm7cwn6MmMmxVkEWM": "Bithumb11",
        "rPyCQm8E5j78PDbrfKF24fRC7qUAk1kDMZ": "Bithumb12",
        "rw3fRcmn5PJyPKuvtAwHDSpEqoW2JKmKbu": "Bithumb13"
    },
    "bitkub": {
        "rE3Cc3i6163Qzo7oc6avFQAxQE4gyCWhGP": "Bitkub 3"
    },
    "BTC Markes": {
        "r94JFtstbXmyG21h3RHKcNfkAHxAQ6HSGC": "BTC Markets 1",
        "rL3ggCUKaiR1iywkGW6PACbn3Y8g5edWiY": "BTC Markets 2",
        "rU7xJs7QmjbiyxpEozNYUFQxaRD5kueY7z": "BTC Markets 3",
        "rwWZxJQ8R2mvvtaFUJHhF6kfV64atBiPww": "BTC Markets 4",
        "r3zUhJWabAMMLT5n631r2wDh9RP3dN1bRy": "BTC Markets 5",
        "rKRYAqMFTTGMZ47eXJVRKcqLJgnPQbXisg": "BTC Markets 6"
    },

    "bybit": {
        "rMrgNBrkE6FdCjWih5VAWkGMrmerrWpiZt": "Bybit 1",
        "rNFKfGBzMspdKfaZdpnEyhkFyw7C1mtQ8x": "Bybit 2",
        "rJn2zAPdFA193sixJwuFixRkYDUtx3apQh": "Bybit 3",
        "rMvCasZ9cohYrSZRNYPTZfoaaSUQMfgQ8G": "Bybit 4",
        "rwBHqnCgNRnk3Kyoc6zon6Wt4Wujj3HNGe": "Bybit 5",
        "raQxZLtqurEXvH5sgijrif7yXMNwvFRkJN": "Bybit 6"
    },
    "coincheck": {
        "rNQEMJA4PsoSrZRn9J6RajAYhcDzzhf8ok": "Coincheck 1",
        "rwgvfze315jjAAxT2TyyDqAPzL68HpAp6v": "Coincheck 2",
        "r99QSej32nAcjQAri65vE5ZXjw6xpUQ2Eh": "Coincheck 3"
    },
    "coinbase": {
        "rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w": "Coinbase1",
        "rw2ciyaNshpHe7bCHo4bRWq6pqqynnWKQg": "Coinbase2",
        "rUfghnh1VAWajpAmxgrzLPiCXJ7RwdJUgt": "Coinbase3",
        "rwpTh9DDa52XkM9nTKp2QrJuCGV5d1mQVP": "Coinbase4",
        "r3YsZdkznVzYBv141qhwXHDWoPUXLdksNw": "Coinbase5",
        "r4sRyacXpbh4HbagmgfoQq8Q3j8ZJzbZ1J": "Coinbase6",
        "rUjfTQpvBr6wsGGxMw6sRmRQGG76nvp8Ln": "Coinbase7",
        "rRmgo6NW1W7GHjC5qEpcpQnq8NE74ZS1P": "Coinbase10",
        "rHrHuQM3E114yMyPjeULWfQmbwVBrHsBEy": "Coinbase11",
        "rLBunuhuRY7aUCnDkSQhaf5ewCvdcWUYjR": "Coinbase12",
        "rDw1Z5BqJejpKCGfncHJ9rwRq2kYLo4sJG": "Coinbase13",
        "rwnYLUsoBQX3ECa1A5bSKLdbPoHKnqf63J": "Coinbase14",
        "rsTtGH7a9mom5X8Y9D3kxroXWvA912RgUZ": "Coinbase (Cold 176)",
        "r9mkuV6bpvok7SZ8Zargiw5KzZHDFbaApy": "Coinbase (Cold 285)",
        "rNaJVWotxZ9nGTBiHRWR6LR1deXHa8FRLf": "Coinbase (Cold 418)",
        "rGG4LZruYFJ34PNCi1doapgA1hynz3gxX7": "Coinbase (Cold 125)",
        "rnVcQzWJP2sJbJF3GgvdAeqveW1V7dT2Vq": "Coinbase (Cold 283)",
        "r417XbsvuBJpkMC4eHtGpvAHxgC24mb6Nc": "Coinbase (Cold 193)",
        "rPeuuqP9rNhskesoA3ferKfp6VT5SvLAzU": "Coinbase (Cold 299)",
        "raMRJ2d3djqwSUBK28W31R7aJQfK21zU1C": "Coinbase (Cold 456)",
        "rBRaRTaq99U216NSDt7dFRrfzAtZzyrgS6": "Coinbase (Cold 188)",
        "rsVDKTbUceVQqNKrSzYj8HtkVcS7TuRWSN": "Coinbase (Cold 36)",
        "rBj8PDBTKKuXWJaWbaEtdkV8hq4oxRWhsB": "Coinbase (Cold 392)",
        "rMJbEvjzqVeGJHs5ySZvuF2dHhWKx69t6G": "Coinbase (Cold 100)",
        "rw4rHH5LrTUZ5WDXieCPT14E89PwnmXtoV": "Coinbase (Cold 48)",
        "rNbMpc8JgLKnXs51KVYAmt4zbDvE8kgQEi": "Coinbase (Cold 232)",
        "rnaxGortNCoxkWUq18jCGmQDeCrLBmiz42": "Coinbase (Cold 92)",
        "rMsfxSZfdj3F1vBeVRte6b83LMV4AtZAHX": "Coinbase (Cold 434)",
        "rf9CWxJKUwHm4eZo3Z8SHi6Z1D6RoqFqqq": "Coinbase (Cold 196)",
        "rKmcvfZ4AeVCsJDNLZg3Xwbs86F33sC6bR": "Coinbase (Cold 78)",
        "rnYzsCmvD35kBntkY5g4kf7hStMGKSQfwz": "Coinbase (Cold 149)",
        "rJQC2RzzALgus6ZZgu34nXnpz67v3bRSzi": "Coinbase (Cold 210)",
        "r939VcVXx5Zx9wJ1TL61StPEKaqaYf75XQ": "Coinbase (Cold 104)",
        "r9rg8WT6KPXE8FGYbsGG6YaEG6wrbLxqF9": "Coinbase (Cold 206)",
        "rGoDpsHfkkSvNatyXHZPiJk7qydd7uahQz": "Coinbase (Cold 183)",
        "raQ3drgGw2eFHTnck6SZxKe2JhQr8Lm8w1": "Coinbase (Cold 108)",
        "rnWnrbjNw5Ezdqy51a769Rror8U3xRkYxK": "Coinbase (Cold 137)",
        "rwTjgH22nenAtDpPWy4g7xPhBqhVU845Az": "Coinbase (Cold 265)",
        "rBAzrxLFZSqni5K67kPqX3WN7VLDTcUVWJ": "Coinbase (Cold 375)",
        "rnioNuMG47FKY7sZ82EtKt1kBfD4Lg5M4S": "Coinbase (Cold 122)",
        "rMAxoQbdkCHYpH9VTmdiyrR1F7T4Yvyk2k": "Coinbase (Cold 400)",
        "rUejaQ5zgB7fMKhj72SPK7xAdGo6ujx2ca": "Coinbase (Cold 87)",
        "rGK3t5Ppw46RciqcHtrUtvcvhD7M99HJvU": "Coinbase (Cold 379)",
        "rUb2Ds39TAXnnbKekuUmJsZk11BaenHWHG": "Coinbase (Cold 353)",
        "rJZkhPxEbvpyuM1tPV2YfkSgSmFPwP4Af6": "Coinbase (Cold 414)",
        "r9gGyhLJNhWRUPEXbcGXR7HowrAgQL4i4B": "Coinbase (Cold 155)",
        "rHCwZG3cNaKSr3aANX36m4McU3pLAj91Jr": "Coinbase (Cold 197)",
        "rLex7Hn4VFotWPCzE1xXnPtx1GfqTzLnJi": "Coinbase (Cold 394)",
        "rEe4cm8ZvQSMS4h4Jwuj3RtCVwqATwZ1sK": "Coinbase (Cold 396)",
        "ram3dNqeea6s9HpyH8ANoFMSTW78Gk3gBv": "Coinbase (Cold 146)",
        "rGthywLPxJPsmCZaWuA7K6xZ5EYJLjoq7e": "Coinbase (Cold 345)",
        "rKt48W1Eg5M6DWD1CkDDYioA7Civ8zEjiy": "Coinbase (Cold 324)",
        "rEEKHC9pyscnFz5hqMEe8dMQY5j1ymLC3Y": "Coinbase (Cold 259)",
        "rnkzrdCPPHhHTEu5XMfmLw2Z5wq9ZNJxFM": "Coinbase (Cold 333)",
        "rNdTXdz2fABUprp4LrvknEiqYXkvpzN4kx": "Coinbase (Cold 248)",
        "rMgdeXXHKpnFi9FUZQgZRc73gDFjVK8PMN": "Coinbase (Cold 290)",
        "rs4qVgzVsYTeTv9Fh5URf6CDeNn22AxXax": "Coinbase (Cold 43)",
        "rUFDke2TLvmLQaAH6LZYmURAfQ1SCQDSLt": "Coinbase (Cold 135)",
        "rJUkHKXn7fonFnYs5aP1igXZ3Y1xzKB1": "Coinbase (Cold 321)",
        "rL2kYqQW7BThQrEVzf1SgohWnXV7adWfqf": "Coinbase (Cold 298)",
        "rHvCuXyoLzurq45ZNy91kzDmGJLqjf42Z8": "Coinbase (Cold 74)",
        "r4VDPsS5yatqpkdBoJxNWh3TWWXTnmR62r": "Coinbase (Cold 31)",
        "rQrYaxwU6vFvA37maEVcs1hLGgxFDxaKZn": "Coinbase (Cold 395)",
        "raon8BEsrawPug1yEs8ChX4ccEC4bhbEbw": "Coinbase (Cold 136)",
        "rNqCrZDNfW3apqmrk94AuAdy35eW5jB2pP": "Coinbase (Cold 181)",
        "rfJL7vFfPsXLhjTctNJJf443tASrrs1Nap": "Coinbase (Cold 409)",
        "rME6BCc8wFqLFtD6yGDMChPEpChN59VCym": "Coinbase (Cold 300)",
        "rNx5iPejwegrf6CXgWNsZMGXgj4C2e2QGo": "Coinbase (Cold 187)",
        "r4pUXa53aRzH11u2ZrPLk1tuM5mFayXwZM": "Coinbase (Cold 403)",
        "rKrur5amu1cx5ZMdfZ7QdwTLyQta7dXzWW": "Coinbase (Cold 141)",
        "rhDUYzz8faQi1NkAkD4UqPGhHVtMML4uY1": "Coinbase (Cold 233)",
        "rH2JhAxcApv8tEJa62jzGZFYgf77NduFDP": "Coinbase (Cold 143)",
        "rp8XdQLjn41ao7CNHyorP4hS8fbPbACoEw": "Coinbase (Cold 247)",
        "rJT8GJhJaiugYSgZW6HuZmaGXYKudNXFbw": "Coinbase (Cold 384)",
        "rsXm9nBire6zqajappuFPLJuydvHDuqz8g": "Coinbase (Cold 124)",
        "rhhJhWUpU7A1enRxKAmWqyV5c9Y1xrVQTm": "Coinbase (Cold 157)",
        "rPQmWocoQACFezEbQmmcRPSEhRxqp1Ksz9": "Coinbase (Cold 302)",
        "rGCc2ah3xtnizjpH3gd2wQm6R837eaULa4": "Coinbase (Cold 438)",
        "r9ZMdQ63S8NvgdCyLpfhkdbWDfQ57eKD9c": "CoinbaseCold366"
    },
    "coinone": {
        "rp2diYfVtpbgEMyaoWnuaWgFCAkqCAEg28": "Coinone1",
        "rPsmHDMkheWZvbAkTA8A9bVnUdadPn7XBK": "Coinone2",
        "rhuCPEoLFYbpbwyhXioSumPKrnfCi3AXJZ": "Coinone3",
        "rMksM39efoP4XyAqEjzFUEowwnVbQTh6KW": "Coinone4",
        "rDKw32dPXHfoeGoD3kVtm76ia1WbxYtU7D": "Coinone5"
    },
    "coinjar": {
        "rPvKH3CoiKnne5wAYphhsWgqAEMf1tRAE7": "Coinjar"
    },
    "crypto.com": {
        "r4DymtkgUAh2wqRxVfdd3Xtswzim6eC6c5": "Crypto.com 1",
        "rPHNKf25y3aqATYfrMv9LQnTRHQUYELXfn": "Crypto.com 2",
        "rJmXYcKCGJSayp4sAdp6Eo4CdSFtDVv7WG": "Crypto.com 3",
        "rKNwXQh9GMjaU8uTqKLECsqyib47g5dMvo": "Crypto.com 4",
        "rKV8HEL3vLc6q9waTiJcewdRdSFyx67QFb": "Crypto Exchange"
    },
    "Doppler Finance": {
        "rprFy94qJB5riJpMmnPDp3ttmVKfcrFiuq": "Doppler Finance 1",
        "rEPQxsSVER2r4HeVR4APrVCB45K68rqgp2": "Doppler Finance 2"
    },

    "firi": {
        "raJHqa1o57DwjtrLCZjdkMKRtfHnbrwSse": "Firi"
    },
    "etoro": {
        "rsdvR9WZzKszBogBJrpLPE64WWyEW4ffzS": "eToro1",
        "raQ9yYPNDQwyeqAAX9xJgjjQ7wUtLxJ5JV": "eToro2",
        "rBMe3zVBLgeh2QN4CeX6B17zwbcN6JEmZB": "eToro3",
        "rEvwSpejhGTbdAXbxRTpGAzPBQkBRZxN5s": "eToro4",
        "rM9EyDmjxeukZGT6wfkxncqeM3ABJsro3a": "eToro5"
    },
    "gate.io": {
        "rHcFoo6a9qT5NHiVn1THQRhsEGcxtYCV4d": "Gate.io 1",
        "rLzxZuZuAHM7k3FzfmhGkXVwScM4QSxoY7": "Gate.io 2",
        "rNnWmrc1EtNRe5SEQEs9pFibcjhpvAiVKF": "Gate.io 3",
        "rNu9U5sSouNoFunHp9e9trsLV6pvsSf54z": "Gate.io 4"
    },
    "gemini": {
        "raBQUYdAhnnojJQ6Xi3eXztZ74ot24RDq1": "Gemini1",
        "raq2gccLh11AwvBrpYcHntUTv4xQNRpyyG": "Gemini2",
        "rBYpyCjNwBDQFrgEdVfyosSgQS6iL6sTHe": "Gemini3"
    },
    "kraken": {
        "rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh": "Kraken1",
        "rUeDDFNp2q7Ymvyv75hFGC8DAcygVyJbNF": "Kraken2",
        "rGZjPjMkfhAqmc1ssEiT753uAgyftHRo2m": "Kraken3",
        "rp7TCczQuQo61dUo1oAgwdpRxLrA8vDaNV": "Kraken4",
        "rEvuKRoEbZSbM5k5Qe5eTD9BixZXsfkxHf": "Kraken5",
        "rnJrjec2vrTJAAQUTMTjj7U6xdXrk9N4mT": "Kraken6",
        "rHapXGCL7KXTovvpEqLfDiZ6WV7vMhPWGJ": "Kraken7"
    },
    "KuCoin": {
         "rLpvuHZFE46NUyZH5XaMvmYRJZF7aory7t": "Kucoin11",
         "rNFugeoj3ZN8Wv6xhuLegUBBPXKCyWLRkB": "Kucoin5",
         "rBxszqhQkhPALtkSpGuVeqR6hNtZ8xTH3T": "Kucoin7",
         "rp4gqz1XdqMsWRZbzPdPAQWw1tg5LuwUVP": "Kucoin8"
    },
    "luno": {
        "rsRy14FvipgqudiGmptJBhr1RtpsgfzKMM": "Luno1",
        "rsbfd5ZYWqy6XXf6hndPbRjDAzfmWc1CeQ": "Luno2"
    },
    "mexc": {
        "rs2dgzYeqYqsk8bvkQR5YPyqsXYcA24MP2": "Mexc"
    },
    "mercadobitcoin": {
        "rnW8je5SsuFjkMSWkgfXvqZH3gLTpXxfFH": "Mercado Bitcoin 1",
        "rPEPYN8sHU3cytBwVm69qPbVztaoj7wNf": "Mercado Bitcoin 3"
    },
    "okx": {
        "rUzWJkXyEtT8ekSSxkBYPqCvHpngcy6Fks": "Okx"
    },
    "paribu": {
        "rM9e4hDCEu4hY8SESypL9ymM2sMauDCncf": "Paribu 3"
    },
    "tradeogre": {
        "rhsZa1NR9GqA7NtQjDe5HtYWZxPAZ4oGrE": "TradeOgre"
    },
    "uphold": {
        "rQrQMKhcw3WnptGeWiYSwX5Tz3otyJqPnq": "Uphold2",
        "rMdG3ju8pgyVh29ELPWaDuA74CpWW6Fxns": "Uphold3",
        "rBEc94rUFfLfTDwwGN7rQGBHc883c2QHhx": "Uphold4",
        "rsX8cp4aj9grKVD9V1K2ouUBXgYsjgUtBL": "Uphold8",
        "rErKXcbZj9BKEMih6eH6ExvBoHn9XLnTWe": "Uphold9",
        "rKe7pZPwdKEubmEDCAu9djJVsQfK4Atmzr": "Uphold11",
        "rsXT3AQqhHDusFs3nQQuwcA1yXRLZJAXKw": "uphold12"
    },
    "upbit": {
        "raQwCVAJVqjrVm1Nj5SFRcX8i22BhdC9WA": "Upbit1",
        "rfL1mn4VTCoHdhHhHMwqpShCFUaDBRk6Z5": "Upbit12",
        "rwa7YXssGVAL9yPKw6QJtCen2UqZbRQqpM": "Upbit13",
        "rNcAdhSLXBrJ3aZUq22HaNtNEPpB5fR8Ri": "Upbit14",
        "r38a3PtqW3M7LRESgaR4dyHjg3AxAmiZCt": "Upbit15",
        "rMNUAfSz2spLEbaBwPnGtxTzZCajJifnzH": "Upbit16",
        "rJWbw1u3oDDRcYLFqiWFjhGWRKVcBAWdgp": "Upbit17",
        "rs48xReB6gjKtTnTfii93iwUhjhTJsW78B": "Upbit18",
        "rJo4m69u9Wd1F8fN2RbgAsJEF6a4hW1nSi": "Upbit19",
        "rLgn612WAgRoZ285YmsQ4t7kb8Ui3csdoU": "Upbit20",
        "r4G689g4KePYLKkyyumM1iUppTP4nhZwVC": "Upbit21",
        "rDxJNbV23mu9xsWoQHoBqZQvc77YcbJXwb": "Upbit22",
        "rHHQeqjz2QyNj1DVoAbcvfaKLv7RxpHMNE": "Upbit23"
    },
     "sbi": {
        "rNRc2S2GSefSkTkAiyjE6LDzMonpeHp6jS": "SBI VC TRADE 4",
        "raSZXZApFg7Nj1B5G6BnhoL6HcTqVMopJ3": "SBI VC Trade 5",
        "r39uEuRjzLaSgvkjTfcejodbSrXLM3cYnX": "SBI VC Trade 6",
        "rDDyH5nfvozKZQCwiBrWfcE528sWsBPWET": "SBI VC Trade 1",
        "rKcVYzVK1f4PhRFjLhWP7QmteG5FpPgRub": "SBI VC Trade 2",
        "rUaESVd1yLMy5VyoJvwwuqE8ZiCb2PEqBR": "SBI VC Trade 3"
    },

    "stake": {
        "rnqZnvzoJjdg7n1P9pmumJ7FQ5wxNH3gYC": "Stake1",
        "razLtrbzXVXYvViLqUKLh8YenGLJid9ZTW": "Stake2",
        "rBA7oBScBPccjDcemGhkmCY82v2ZeLa2K2f": "Stake3",
        "rBndy89HdamJ3UHNekAS6ALjW9WoCE2W5s": "Stake4"
    },
    "korbit": {
        "rBTjeJu1Rvnbq476Y7PDnvnXUeERV9CxEQ": "Korbit1",
        "rJRarS792K6LTqHsFkZGzM1Ue6G8jZ2AfK": "Korbit2",
        "rGU8q9qNCCQG2eMgJpLJJ1YFF5JAbntqau": "Korbit3",
        "r9WGxuEbUSh3ziYt34mBRViPbqVxZmwsu3": "Korbit4",
        "rNWWbLxbZRKd51NNZCEjoSNovrrx7yiPyt": "Korbit5",
        "rGq74nAmw1ARejUNLYEBGxiQBaoNtryEe9": "Korbit6",
        "rsYFhEk4uFvwvvKJomHL7KhdF29r2sw9KD": "Korbit7",
        "rwnXZEUe7o29SPcWZwnZukR8fdXmFMWHAN": "Korbit8"
    },
    "swissbirg": {
        "rfyE1wqH1YY3u6BcauQwYuoD13GVtJErXq": "SwissBirg 3"
    },
    "virtune": {
        "rnaiDK2aDkDCCoRk3n9oyzbrtBcGPdHL2t": "Virtune"
    },
    "Evernorth": {
        "rsT3yYMkuicxW1hYsy787mg5XHhkz2uQRk": "Evernorth1",
        "rKXXrAgpkHQN8m4HxAQCYmDCPPUByc9mVq": "Evernorth2",
        "rKhjV48GdbgxAAfSvusqGNktGwAxnzzXpv": "Evernorth3",
        "rGJBNGkDeRPNvNJCi57Ht1ncdht9SuctLe": "Evernorth4",
        "rJX1qoSGYmx5NWJEpsBGKvxmYpGR7mDtop": "Evernorth5", 
        "rJuyHPDFpfeVhxfxZboTf7BYu1ptGus1v3": "Evernorth6",
        "rUgQciCPP1AiwQ9f5zstYu9RzVfsKQRGc2": "Evernorth7",
        "rPhQdyEaz4kcSoYKTAQhvkvdYxWKKw2vSC": "Evernorth8",
        "rGy4zJtGfGtF7dtjZmBraQTcfZSQgwqpaa": "Evernorth9"
}

# ============================================================================
# CUSTOM CSS - Enhanced Dark/Light Mode Support
# ============================================================================

def inject_custom_css():
    st.markdown("""
    <style>
    /* Base Theme Variables */
    :root {
        --primary: #00d4ff;
        --success: #00c853;
        --danger: #ff5252;
        --bg-card: rgba(26, 26, 46, 0.9);
        --border-color: rgba(0, 212, 255, 0.3);
    }
    
    /* Metric Cards */
    [data-testid="stMetric"] {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        padding: 20px;
        border-radius: 12px;
        border: 1px solid var(--border-color);
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
    }
    [data-testid="stMetric"] label { 
        color: var(--primary) !important; 
        font-size: 0.85rem !important;
        font-weight: 600 !important;
    }
    [data-testid="stMetric"] [data-testid="stMetricValue"] {
        color: #ffffff !important;
        font-size: 1.6rem !important;
    }
    
    /* Status Badge */
    .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
    }
    .status-live {
        background: rgba(0, 200, 83, 0.2);
        color: #00c853;
        border: 1px solid #00c853;
    }
    .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #00c853;
        animation: pulse 2s infinite;
    }
    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
    }
    
    /* Price Widget */
    .price-widget {
        background: linear-gradient(135deg, #0a1628 0%, #1a2940 100%);
        border: 2px solid var(--primary);
        border-radius: 12px;
        padding: 15px 20px;
        box-shadow: 0 0 20px rgba(0, 212, 255, 0.15);
    }
    
    /* Responsive */
    @media (max-width: 768px) {
        [data-testid="stMetric"] { padding: 12px; }
        [data-testid="stMetric"] [data-testid="stMetricValue"] { font-size: 1.2rem !important; }
    }
    
    /* Auto-refresh indicator */
    .refresh-indicator {
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(0, 212, 255, 0.1);
        border: 1px solid var(--primary);
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 12px;
        color: var(--primary);
        z-index: 1000;
    }
    </style>
    """, unsafe_allow_html=True)


# ============================================================================
# DATA FETCHING - Concurrent/Parallel
# ============================================================================

def fetch_single_balance(address: str, session: requests.Session) -> tuple:
    """Fetch balance for a single address with fallback URLs"""
    for url in RIPPLED_URLS:
        try:
            data = {
                "method": "account_info",
                "params": [{"account": address, "ledger_index": "validated", "strict": True}]
            }
            response = session.post(url, json=data, timeout=REQUEST_TIMEOUT)
            if response.status_code == 200:
                result = response.json()
                if "result" in result and "account_data" in result["result"]:
                    balance = int(result["result"]["account_data"]["Balance"]) / 1_000_000
                    return (address, balance, None)
        except Exception as e:
            continue
    return (address, 0.0, "Failed to fetch")


@st.cache_data(ttl=300, show_spinner=False)
def fetch_all_balances_parallel() -> Dict:
    """Fetch all balances using parallel requests"""
    results = {}
    all_addresses = []
    address_to_exchange = {}
    address_to_name = {}
    
    # Build address mapping
    for exchange_name, wallets in EXCHANGES.items():
        for address, wallet_name in wallets.items():
            all_addresses.append(address)
            address_to_exchange[address] = exchange_name
            address_to_name[address] = wallet_name
    
    # Initialize results structure
    for exchange_name, wallets in EXCHANGES.items():
        results[exchange_name] = {
            "total": 0,
            "historical": 0,
            "wallets": [],
            "wallet_count": len(wallets),
            "has_historical": False,
            "errors": 0
        }
    
    # Parallel fetch with ThreadPoolExecutor
    balances = {}
    with requests.Session() as session:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {executor.submit(fetch_single_balance, addr, session): addr 
                      for addr in all_addresses}
            
            for future in as_completed(futures):
                address, balance, error = future.result()
                balances[address] = (balance, error)
    
    # Process results
    for address, (balance, error) in balances.items():
        exchange_name = address_to_exchange[address]
        wallet_name = address_to_name[address]
        historical = HISTORICAL_BALANCES_20250224.get(address)
        
        wallet_info = {
            "address": address,
            "name": wallet_name,
            "balance": balance,
            "historical": historical,
            "error": error
        }
        
        if historical is not None:
            results[exchange_name]["historical"] += historical
            results[exchange_name]["has_historical"] = True
            wallet_info["change"] = balance - historical
            wallet_info["change_pct"] = ((balance - historical) / historical * 100) if historical > 0 else 0
        
        results[exchange_name]["total"] += balance
        results[exchange_name]["wallets"].append(wallet_info)
        if error:
            results[exchange_name]["errors"] += 1
    
    # Calculate change for exchanges with historical data
    for exchange_name, info in results.items():
        if info["has_historical"] and info["historical"] > 0:
            info["change"] = info["total"] - info["historical"]
            info["change_pct"] = (info["change"] / info["historical"]) * 100
    
    return results


@st.cache_data(ttl=60, show_spinner=False)
def get_xrp_price() -> Dict:
    """Fetch XRP price from CoinGecko"""
    try:
        response = requests.get(
            "https://api.coingecko.com/api/v3/simple/price",
            params={"ids": "ripple", "vs_currencies": "usd", "include_24hr_change": "true"},
            timeout=5
        )
        if response.status_code == 200:
            data = response.json()
            return {"price": data["ripple"]["usd"], "change_24h": data["ripple"]["usd_24h_change"]}
    except:
        pass
    return {"price": None, "change_24h": None}


def create_summary_dataframe(data: Dict) -> pd.DataFrame:
    """Create summary DataFrame"""
    rows = []
    for exchange, info in data.items():
        row = {
            "Exchange": exchange.title(),
            "Balance (XRP)": info["total"],
            "Wallet Count": info["wallet_count"],
            "Errors": info.get("errors", 0)
        }
        if info.get("has_historical"):
            row[f"Balance ({HISTORICAL_DATE})"] = info["historical"]
            row["Change (XRP)"] = info.get("change", 0)
            row["Change (%)"] = info.get("change_pct", 0)
        else:
            row[f"Balance ({HISTORICAL_DATE})"] = None
            row["Change (XRP)"] = None
            row["Change (%)"] = None
        rows.append(row)
    
    df = pd.DataFrame(rows)
    df = df.sort_values("Balance (XRP)", ascending=False).reset_index(drop=True)
    total = df["Balance (XRP)"].sum()
    df["Market Share (%)"] = (df["Balance (XRP)"] / total * 100) if total > 0 else 0
    df.index = df.index + 1
    df.index.name = "Rank"
    return df

<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ESGLMXN5VE"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-ESGLMXN5VE');
</script>

# ============================================================================
# MAIN APP
# ============================================================================

def main():
    inject_custom_css()
    
    # Header with status
    col_title, col_status = st.columns([4, 1])
    with col_title:
        st.title("💎 XRP Exchange Holdings Tracker")
    with col_status:
        st.markdown("""
            <div class="status-badge status-live">
                <span class="status-dot"></span>
                LIVE
            </div>
        """, unsafe_allow_html=True)
    
    # XRP Price Display
    xrp_data = get_xrp_price()
    if xrp_data["price"]:
        change_color = "#00c853" if xrp_data["change_24h"] >= 0 else "#ff5252"
        change_sign = "+" if xrp_data["change_24h"] >= 0 else ""
        st.markdown(f"""
            <div class="price-widget">
                <span style="color: #00d4ff; font-size: 12px; font-weight: 600;">XRP PRICE</span>
                <span style="color: #fff; font-size: 24px; font-weight: bold; margin-left: 15px;">${xrp_data["price"]:.4f}</span>
                <span style="color: {change_color}; font-size: 14px; margin-left: 10px;">{change_sign}{xrp_data["change_24h"]:.2f}%</span>
            </div>
        """, unsafe_allow_html=True)
    
    st.markdown(f"Real-time tracking | Benchmark: **{HISTORICAL_DATE}**")
    
    # Sidebar
    with st.sidebar:
        st.header("⚙️ Settings")
        
        # Auto-refresh
        auto_refresh = st.checkbox("🔄 Auto-refresh", value=False)
        refresh_interval = st.selectbox("Interval", [60, 120, 300, 600], format_func=lambda x: f"{x//60} min" if x >= 60 else f"{x}s", disabled=not auto_refresh)
        
        if st.button("🔄 Refresh Now", type="primary", use_container_width=True):
            st.cache_data.clear()
            st.rerun()
        
        st.markdown("---")
        
        # Filters
        st.subheader("📊 Filters")
        all_exchanges = list(EXCHANGES.keys())
        selected_exchanges = st.multiselect("Exchanges", options=all_exchanges, default=all_exchanges)
        
        st.markdown("---")
        
        # Display options
        show_historical = st.checkbox("Show historical comparison", value=True)
        show_wallet_details = st.checkbox("Show wallet details", value=False)
        chart_type = st.selectbox("Chart Type", ["Bar", "Treemap", "Pie"])
        top_n = st.slider("Top N", 5, 20, 10)
        
        st.markdown("---")
        st.caption(f"Updated: {datetime.now().strftime('%H:%M:%S')}")
    
    # Auto-refresh logic
    if auto_refresh:
        st.markdown(f"""
            <div class="refresh-indicator">
                ⏱️ Auto-refresh: {refresh_interval//60}m
            </div>
        """, unsafe_allow_html=True)
        time.sleep(0.1)
        st_autorefresh = st.empty()
        # Use streamlit's built-in rerun with timer
        if 'last_refresh' not in st.session_state:
            st.session_state.last_refresh = time.time()
        if time.time() - st.session_state.last_refresh > refresh_interval:
            st.session_state.last_refresh = time.time()
            st.cache_data.clear()
            st.rerun()
    
    if not selected_exchanges:
        st.warning("⚠️ Please select at least one exchange.")
        return
    
    # Fetch data with loading indicator
    with st.spinner("⚡ Fetching live data (parallel)..."):
        data = fetch_all_balances_parallel()
    
    filtered_data = {k: v for k, v in data.items() if k in selected_exchanges}
    df = create_summary_dataframe(filtered_data)
    
    # Key Metrics
    st.markdown("### 📈 Market Overview")
    total_xrp = df["Balance (XRP)"].sum()
    top3_share = df.head(3)["Market Share (%)"].sum()
    exchange_count = len(df)
    total_errors = sum(info.get("errors", 0) for info in filtered_data.values())
    
    cols = st.columns(5)
    with cols[0]:
        st.metric("Total XRP", f"{total_xrp:,.0f}")
    with cols[1]:
        st.metric("Exchanges", f"{exchange_count}")
    with cols[2]:
        st.metric("Top 3 Share", f"{top3_share:.1f}%")
    with cols[3]:
        if show_historical:
            total_hist = df[f"Balance ({HISTORICAL_DATE})"].dropna().sum()
            change = total_xrp - total_hist if total_hist > 0 else 0
            st.metric("Net Change", f"{change:+,.0f}")
    with cols[4]:
        if total_errors > 0:
            st.metric("⚠️ Errors", f"{total_errors}", delta="retry later", delta_color="inverse")
        else:
            st.metric("Status", "✅ All OK")
    
    st.markdown("---")
    
    # Charts
    col_chart, col_table = st.columns([1.2, 1])
    
    with col_chart:
        st.markdown(f"### 📊 Top {top_n} Holdings")
        chart_df = df.head(top_n)
        
        if chart_type == "Bar":
            fig = px.bar(chart_df, x="Exchange", y="Balance (XRP)", 
                        color="Market Share (%)", color_continuous_scale="Blues",
                        text=chart_df["Balance (XRP)"].apply(lambda x: f"{x/1e6:.1f}M"))
            fig.update_traces(textposition="outside")
            fig.update_layout(xaxis_tickangle=-45, height=450, showlegend=False)
        elif chart_type == "Treemap":
            fig = px.treemap(chart_df, path=["Exchange"], values="Balance (XRP)",
                           color="Balance (XRP)", color_continuous_scale="Blues")
            fig.update_layout(height=450)
        else:
            fig = px.pie(chart_df, names="Exchange", values="Balance (XRP)", hole=0.4)
            fig.update_layout(height=450)
        
        st.plotly_chart(fig, use_container_width=True)
    
    with col_table:
        st.markdown("### 🏆 Rankings")
        display_cols = ["Exchange", "Balance (XRP)", "Market Share (%)"]
        if show_historical:
            display_cols.extend(["Change (XRP)", "Change (%)"])
        
        display_df = df[display_cols].copy()
        display_df["Balance (XRP)"] = display_df["Balance (XRP)"].apply(lambda x: f"{x:,.0f}")
        display_df["Market Share (%)"] = display_df["Market Share (%)"].apply(lambda x: f"{x:.2f}%")
        if show_historical:
            display_df["Change (XRP)"] = display_df["Change (XRP)"].apply(lambda x: f"{x:+,.0f}" if pd.notna(x) else "N/A")
            display_df["Change (%)"] = display_df["Change (%)"].apply(lambda x: f"{x:+.2f}%" if pd.notna(x) else "N/A")
        
        st.dataframe(display_df, use_container_width=True, height=400)
    
    # Historical Analysis
    if show_historical:
        st.markdown("---")
        st.markdown(f"### 📊 Change Since {HISTORICAL_DATE}")
        hist_df = df[df["Change (XRP)"].notna()].copy()
        
        if len(hist_df) > 0:
            col1, col2 = st.columns(2)
            with col1:
                sorted_df = hist_df.sort_values("Change (XRP)")
                colors = ['#ff5252' if x < 0 else '#00c853' for x in sorted_df["Change (XRP)"]]
                fig = go.Figure(go.Bar(x=sorted_df["Change (XRP)"], y=sorted_df["Exchange"],
                                      orientation='h', marker_color=colors))
                fig.update_layout(title="Absolute Change", height=350)
                st.plotly_chart(fig, use_container_width=True)
            
            with col2:
                sorted_pct = hist_df.sort_values("Change (%)")
                colors_pct = ['#ff5252' if x < 0 else '#00c853' for x in sorted_pct["Change (%)"]]
                fig2 = go.Figure(go.Bar(x=sorted_pct["Change (%)"], y=sorted_pct["Exchange"],
                                       orientation='h', marker_color=colors_pct))
                fig2.update_layout(title="Percentage Change", height=350)
                st.plotly_chart(fig2, use_container_width=True)
    
    # Wallet Details
    if show_wallet_details:
        st.markdown("---")
        st.markdown("### 🔍 Wallet Details")
        selected = st.selectbox("Select Exchange", options=selected_exchanges)
        if selected and selected in filtered_data:
            wallet_df = pd.DataFrame(filtered_data[selected]["wallets"])
            wallet_df = wallet_df.sort_values("balance", ascending=False)
            wallet_df["balance"] = wallet_df["balance"].apply(lambda x: f"{x:,.0f}")
            st.dataframe(wallet_df[["name", "address", "balance"]], use_container_width=True)
    
    # Export
    st.markdown("---")
    col1, col2 = st.columns(2)
    with col1:
        csv = df.to_csv()
        st.download_button("📥 Download CSV", csv, f"xrp_holdings_{datetime.now().strftime('%Y%m%d')}.csv", "text/csv")
    with col2:
        json_str = json.dumps(filtered_data, indent=2, default=str)
        st.download_button("📥 Download JSON", json_str, f"xrp_holdings_{datetime.now().strftime('%Y%m%d')}.json", "application/json")
    
    st.caption("💡 Data cached for 5 minutes. Parallel fetching enabled for faster loading.")


if __name__ == "__main__":
    main()
