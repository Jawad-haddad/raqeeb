import os
import glob
import pandas as pd
import numpy as np
import warnings
warnings.filterwarnings('ignore')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(BASE_DIR, "features_dataset.csv")
WINDOW_SIZE_SECONDS = 10

def compute_csi_features(csi_string):
    try:
        csi_raw = np.array(csi_string.strip().split(), dtype=int)
        if len(csi_raw) % 2 != 0: csi_raw = csi_raw[:-1]
        complex_csi = csi_raw[0::2] + 1j * csi_raw[1::2]
        amps = np.abs(complex_csi)
        return {'csi_mean': float(np.mean(amps)), 'csi_std': float(np.std(amps)), 'csi_max': float(np.max(amps)), 'csi_min': float(np.min(amps)), 'csi_range': float(np.max(amps) - np.min(amps)), 'csi_q25': float(np.percentile(amps, 25)), 'csi_q75': float(np.percentile(amps, 75)), 'csi_iqr': float(np.percentile(amps, 75) - np.percentile(amps, 25)), 'csi_skew': float(pd.Series(amps).skew())}
    except Exception:
        return {k: 0.0 for k in ['csi_mean', 'csi_std', 'csi_max', 'csi_min', 'csi_range', 'csi_q25', 'csi_q75', 'csi_iqr', 'csi_skew']}

def process_data():
    search_paths = [os.path.join(BASE_DIR, "round_*", "*.csv"), os.path.join(BASE_DIR, "Round_*", "*.csv")]
    all_files = []
    for path in search_paths: all_files.extend(glob.glob(path))

    if not all_files:
        print("ERROR: No CSV files found!"); return

    df_list = []
    for file in sorted(all_files):
        try:
            block_name = os.path.basename(file).split('_')[1]
            if block_name == '10-1': continue
            df = pd.read_csv(file)
            df['block_target'] = f"Block_{block_name}"
            df_list.append(df)
        except Exception as e: print(f"Warning — could not read {file}: {e}")

    full_df = pd.concat(df_list, ignore_index=True)
    full_df['label'] = full_df['label'].replace({'half full moving': 'half room moving'})
    full_df['laptop_timestamp'] = pd.to_datetime(full_df['laptop_timestamp'], errors='coerce')
    full_df = full_df.dropna(subset=['laptop_timestamp'])

    features_list = []
    for (block, label), group in full_df.groupby(['block_target', 'label']):
        group = group.sort_values('laptop_timestamp').set_index('laptop_timestamp')
        for _, window in group.groupby(pd.Grouper(freq=f'{WINDOW_SIZE_SECONDS}s')):
            if len(window) < 5: continue
            s = [window[window['sniffer_id'] == i+1]['rssi'].mean() for i in range(4)]
            s = [float(v) if pd.notna(v) else -100.0 for v in s]
            rssi_mean = float(np.mean(s)); abs_s = [abs(v) for v in s]
            row = {'block': block, 'label': label, 'rssi_s1': s[0], 'rssi_s2': s[1], 'rssi_s3': s[2], 'rssi_s4': s[3], 'rel_s1': s[0]-rssi_mean, 'rel_s2': s[1]-rssi_mean, 'rel_s3': s[2]-rssi_mean, 'rel_s4': s[3]-rssi_mean, 'rssi_std': float(np.std(s)), 'rssi_range': max(s)-min(s), 'csi_mean': float(window['csi_mean'].mean()), 'csi_std': float(window['csi_std'].mean()), 'csi_max': float(window['csi_max'].mean()), 'csi_min': float(window['csi_min'].mean()), 'csi_range': float(window['csi_range'].mean()), 'csi_q25': float(window['csi_q25'].mean()), 'csi_q75': float(window['csi_q75'].mean()), 'csi_iqr': float(window['csi_iqr'].mean()), 'csi_skew': float(window['csi_skew'].mean()), 'ratio_s1_s2': abs_s[0]/abs_s[1] if abs_s[1]!=0 else 0.0, 'ratio_s3_s4': abs_s[2]/abs_s[3] if abs_s[3]!=0 else 0.0, 'ratio_s1_s4': abs_s[0]/abs_s[3] if abs_s[3]!=0 else 0.0, 'ratio_s2_s3': abs_s[1]/abs_s[2] if abs_s[2]!=0 else 0.0, 'pos_left_right': (abs_s[0]+abs_s[2])/(abs_s[1]+abs_s[3]) if (abs_s[1]+abs_s[3])!=0 else 0.0, 'pos_front_back': (abs_s[0]+abs_s[1])/(abs_s[2]+abs_s[3]) if (abs_s[2]+abs_s[3])!=0 else 0.0}
            features_list.append(row)
    pd.DataFrame(features_list).to_csv(OUTPUT_FILE, index=False)

if __name__ == "__main__": process_data()
