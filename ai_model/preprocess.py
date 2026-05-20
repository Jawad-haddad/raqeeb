import os
import glob
import pandas as pd
import numpy as np
import warnings
warnings.filterwarnings('ignore')

# ── Dynamic Path Anchoring ───────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(BASE_DIR, "features_dataset.csv")
# ────────────────────────────────────────────────────────────

WINDOW_SIZE_SECONDS = 10

def compute_csi_features(csi_string):
    """Extract 9 features from raw CSI subcarrier data."""
    try:
        csi_raw = np.array(csi_string.strip().split(), dtype=int)
        if len(csi_raw) % 2 != 0:
            csi_raw = csi_raw[:-1]
        complex_csi = csi_raw[0::2] + 1j * csi_raw[1::2]
        amps = np.abs(complex_csi)
        return {
            'csi_mean':  float(np.mean(amps)),
            'csi_std':   float(np.std(amps)),
            'csi_max':   float(np.max(amps)),
            'csi_min':   float(np.min(amps)),
            'csi_range': float(np.max(amps) - np.min(amps)),
            'csi_q25':   float(np.percentile(amps, 25)),
            'csi_q75':   float(np.percentile(amps, 75)),
            'csi_iqr':   float(np.percentile(amps, 75) - np.percentile(amps, 25)),
            'csi_skew':  float(pd.Series(amps).skew()),
        }
    except Exception:
        return {k: 0.0 for k in [
            'csi_mean', 'csi_std', 'csi_max', 'csi_min',
            'csi_range', 'csi_q25', 'csi_q75', 'csi_iqr', 'csi_skew'
        ]}


def process_data():
    print("=" * 50)
    print("  PREPROCESS.PY — Building features_dataset.csv")
    print("=" * 50)

    print("\nScanning for CSV files in Round_* folders...")
    # Dynamically locate the Round folders relative to BASE_DIR
    search_path = os.path.join(BASE_DIR, "Round_*", "*.csv")
    all_files = glob.glob(search_path)

    if not all_files:
        print("ERROR: No CSV files found!")
        print(f"Expected path: {os.path.join(BASE_DIR, 'Round_*', '*.csv')}")
        print("Make sure Round_1, Round_2, Round_3 folders exist inside the ai_model folder.")
        return

    print(f"Found {len(all_files)} files.\n")

    df_list = []
    for file in sorted(all_files):
        try:
            block_name = os.path.basename(file).split('_')[1]
            # skip the duplicate block recorded by mistake
            if block_name == '10-1':
                print(f"  Skipping duplicate: {file}")
                continue
            df = pd.read_csv(file)
            df['block_target'] = f"Block_{block_name}"
            df_list.append(df)
        except Exception as e:
            print(f"  Warning — could not read {file}: {e}")

    print("Merging all data...")
    full_df = pd.concat(df_list, ignore_index=True)

    # Unify label names (same condition, different names across rounds)
    full_df['label'] = full_df['label'].replace({
        'half full moving': 'half room moving'
    })

    full_df['laptop_timestamp'] = pd.to_datetime(
        full_df['laptop_timestamp'], errors='coerce'
    )
    full_df = full_df.dropna(subset=['laptop_timestamp'])
    print(f"Total raw rows loaded: {len(full_df)}")

    print("Computing rich CSI features (9 per reading)...")
    csi_feats = full_df['csi_array'].apply(compute_csi_features)
    full_df = pd.concat([full_df, pd.DataFrame(list(csi_feats))], axis=1)

    print(f"Grouping into {WINDOW_SIZE_SECONDS}-second windows...")
    features_list = []

    for (block, label), group in full_df.groupby(['block_target', 'label']):
        group = group.sort_values('laptop_timestamp').set_index('laptop_timestamp')
        windows = group.groupby(pd.Grouper(freq=f'{WINDOW_SIZE_SECONDS}s'))

        for _, window in windows:
            if window.empty or len(window) < 5:
                continue

            # Average RSSI per sniffer in this window
            s1 = window[window['sniffer_id'] == 1]['rssi'].mean()
            s2 = window[window['sniffer_id'] == 2]['rssi'].mean()
            s3 = window[window['sniffer_id'] == 3]['rssi'].mean()
            s4 = window[window['sniffer_id'] == 4]['rssi'].mean()

            # Use -100 if a sniffer had no packets in this window
            s1 = float(s1) if pd.notna(s1) else -100.0
            s2 = float(s2) if pd.notna(s2) else -100.0
            s3 = float(s3) if pd.notna(s3) else -100.0
            s4 = float(s4) if pd.notna(s4) else -100.0

            rssi_vals = [s1, s2, s3, s4]
            rssi_mean = float(np.mean(rssi_vals))
            abs_s     = [abs(v) for v in rssi_vals]

            row = {
                # Identifiers
                'block': block,
                'label': label,
                # Raw RSSI from each sniffer
                'rssi_s1': s1,
                'rssi_s2': s2,
                'rssi_s3': s3,
                'rssi_s4': s4,
                # Relative RSSI — removes whole-room signal shift between conditions
                'rel_s1': s1 - rssi_mean,
                'rel_s2': s2 - rssi_mean,
                'rel_s3': s3 - rssi_mean,
                'rel_s4': s4 - rssi_mean,
                # Signal spread across sniffers
                'rssi_std':   float(np.std(rssi_vals)),
                'rssi_range': max(rssi_vals) - min(rssi_vals),
                # CSI features (9 total)
                'csi_mean':  float(window['csi_mean'].mean()),
                'csi_std':   float(window['csi_std'].mean()),
                'csi_max':   float(window['csi_max'].mean()),
                'csi_min':   float(window['csi_min'].mean()),
                'csi_range': float(window['csi_range'].mean()),
                'csi_q25':   float(window['csi_q25'].mean()),
                'csi_q75':   float(window['csi_q75'].mean()),
                'csi_iqr':   float(window['csi_iqr'].mean()),
                'csi_skew':  float(window['csi_skew'].mean()),
                # Ratio features (location fingerprint)
                'ratio_s1_s2': abs_s[0] / abs_s[1] if abs_s[1] != 0 else 0.0,
                'ratio_s3_s4': abs_s[2] / abs_s[3] if abs_s[3] != 0 else 0.0,
                'ratio_s1_s4': abs_s[0] / abs_s[3] if abs_s[3] != 0 else 0.0,
                'ratio_s2_s3': abs_s[1] / abs_s[2] if abs_s[2] != 0 else 0.0,
                # Position estimation features
                'pos_left_right': (abs_s[0] + abs_s[2]) / (abs_s[1] + abs_s[3])
                                   if (abs_s[1] + abs_s[3]) != 0 else 0.0,
                'pos_front_back': (abs_s[0] + abs_s[1]) / (abs_s[2] + abs_s[3])
                                   if (abs_s[2] + abs_s[3]) != 0 else 0.0,
            }
            features_list.append(row)

    features_df = pd.DataFrame(features_list)
    features_df.to_csv(OUTPUT_FILE, index=False)

    print(f"\nDone! Created '{OUTPUT_FILE}'")
    print(f"  Total windows : {len(features_df)}")
    print(f"  Blocks        : {features_df['block'].nunique()}")
    print(f"  Features      : {len(features_df.columns) - 2}")
    print(f"\nWindows per condition:")
    print(features_df['label'].value_counts().to_string())
    print()


if __name__ == "__main__":
    process_data()
