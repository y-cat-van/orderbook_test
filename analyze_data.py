
import csv
from datetime import datetime

def analyze_csv(file_path):
    stats = []
    with open(file_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not row['first_below_04'] or not row['first_back_above_045']:
                continue
            
            try:
                min_ask = float(row['min_ask'])
                # Parsing times like "2026/01/15 00:46:53"
                first_below = datetime.strptime(row['first_below_04'], "%Y/%m/%d %H:%M:%S")
                back_above = datetime.strptime(row['first_back_above_045'], "%Y/%m/%d %H:%M:%S")
                last_below = datetime.strptime(row['last_below_04'], "%Y/%m/%d %H:%M:%S")
                
                rebound_duration = (back_above - first_below).total_seconds()
                total_low_duration = (last_below - first_below).total_seconds()
                
                stats.append({
                    'asset': row['asset'],
                    'min_ask': min_ask,
                    'rebound_duration': rebound_duration,
                    'total_low_duration': total_low_duration,
                    'is_volatile': last_below > back_above
                })
            except Exception as e:
                continue

    if not stats:
        print("No valid data found for analysis.")
        return

    avg_min = sum(s['min_ask'] for s in stats) / len(stats)
    avg_rebound = sum(s['rebound_duration'] for s in stats) / len(stats)
    volatile_count = sum(1 for s in stats if s['is_volatile'])
    
    print(f"Total samples analyzed: {len(stats)}")
    print(f"Average Min Ask (when below 0.4): {avg_min:.4f}")
    print(f"Average Rebound Duration (to 0.45): {avg_rebound:.2f}s")
    print(f"Volatile samples (dip-bounce-dip): {volatile_count} ({volatile_count/len(stats)*100:.2f}%)")
    
    # Depth distribution
    depths = [s['min_ask'] for s in stats]
    depths.sort()
    print(f"Min Ask Percentiles: 25th: {depths[int(len(depths)*0.25)]}, 50th: {depths[int(len(depths)*0.5)]}, 75th: {depths[int(len(depths)*0.75)]}")

def analyze_general_extremes(file_path):
    stats = []
    with open(file_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                min_ask = float(row['min_ask'])
                max_ask = float(row['max_ask'])
                stats.append({
                    'min_ask': min_ask,
                    'max_ask': max_ask,
                    'range': max_ask - min_ask
                })
            except Exception:
                continue
    
    if not stats: return
    
    avg_min = sum(s['min_ask'] for s in stats) / len(stats)
    avg_max = sum(s['max_ask'] for s in stats) / len(stats)
    avg_range = sum(s['range'] for s in stats) / len(stats)
    
    print(f"\n--- General Extremes Analysis ({file_path}) ---")
    print(f"Total samples: {len(stats)}")
    print(f"Average Min Ask: {avg_min:.4f}")
    print(f"Average Max Ask: {avg_max:.4f}")
    print(f"Average Range: {avg_range:.4f}")
    
    ranges = sorted([s['range'] for s in stats])
    print(f"Range Percentiles: 25th: {ranges[int(len(ranges)*0.25)]:.4f}, 50th: {ranges[int(len(ranges)*0.5)]:.4f}, 75th: {ranges[int(len(ranges)*0.75)]:.4f}")

analyze_csv('single_asset_extremes_trade.csv')
analyze_general_extremes('single_asset_extremes.csv')
