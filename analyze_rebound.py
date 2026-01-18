import pandas as pd
import numpy as np
from datetime import datetime

def analyze_csv(file_path):
    try:
        df = pd.read_csv(file_path)
        if df.empty:
            return None
        return df
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        return None

def main():
    files = ['strategy_analysis.csv', 'rebound.csv']
    dfs = []
    for f in files:
        data = analyze_csv(f)
        if data is not None:
            dfs.append(data)
    
    if not dfs:
        print("No data found to analyze.")
        return

    df = pd.concat(dfs, ignore_index=True)
    
    # Preprocessing
    # Ensure numeric types
    numeric_cols = ['anchor_price', 'buy_price', 'sell_price']
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    
    # Calculate drops and profits
    df['flash_drop'] = df['anchor_price'] - df['buy_price']
    df['actual_profit'] = df['sell_price'] - df['buy_price']
    
    # Calculate durations
    def get_duration(start, end):
        try:
            fmt = '%Y/%m/%Y %H:%M:%S' # Adjust based on your format
            # The format in CSV is like "2026/01/17 11:39:24"
            t1 = pd.to_datetime(start)
            t2 = pd.to_datetime(end)
            return (t2 - t1).total_seconds()
        except:
            return np.nan

    df['flash_duration'] = df.apply(lambda x: get_duration(x['anchor_time'], x['buy_time']), axis=1)
    df['hold_duration'] = df.apply(lambda x: get_duration(x['buy_time'], x['sell_time']), axis=1)

    print("=== Global Statistics ===")
    total_trades = len(df)
    status_counts = df['status'].value_counts()
    tp_count = status_counts.get('TAKE_PROFIT', 0)
    sl_count = status_counts.get('STOP_LOSS', 0)
    force_count = status_counts.get('FORCE_CLEAR', 0)
    
    win_rate = tp_count / (tp_count + sl_count) if (tp_count + sl_count) > 0 else 0
    
    print(f"Total Trades: {total_trades}")
    print(f"Take Profit: {tp_count}")
    print(f"Stop Loss: {sl_count}")
    print(f"Force Clear: {force_count}")
    print(f"Win Rate (TP/TP+SL): {win_rate:.2%}")
    print(f"Avg Flash Drop: {df['flash_drop'].mean():.4f}")
    print(f"Avg Hold Duration: {df['hold_duration'].mean():.2f}s")
    
    print("\n=== Statistics by Asset ===")
    asset_stats = df.groupby('asset').agg({
        'status': lambda x: (x == 'TAKE_PROFIT').sum() / ((x == 'TAKE_PROFIT').sum() + (x == 'STOP_LOSS').sum()) if ((x == 'TAKE_PROFIT').sum() + (x == 'STOP_LOSS').sum()) > 0 else 0,
        'flash_drop': 'mean',
        'hold_duration': 'mean',
        'buy_price': 'count'
    }).rename(columns={'status': 'win_rate', 'buy_price': 'trade_count'})
    print(asset_stats)

    print("\n=== Statistics by Direction ===")
    dir_stats = df.groupby('direction').agg({
        'status': lambda x: (x == 'TAKE_PROFIT').sum() / ((x == 'TAKE_PROFIT').sum() + (x == 'STOP_LOSS').sum()) if ((x == 'TAKE_PROFIT').sum() + (x == 'STOP_LOSS').sum()) > 0 else 0,
        'flash_drop': 'mean',
        'trade_count': 'count' if 'trade_count' in df.columns else lambda x: len(x)
    })
    print(dir_stats)

    print("\n=== Flash Drop Distribution (Buy Trigger Quality) ===")
    print(df['flash_drop'].describe())

if __name__ == "__main__":
    main()
