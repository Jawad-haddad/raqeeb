import os
import pandas as pd
import numpy as np
import pickle
from sklearn.svm import SVC
from sklearn.metrics import accuracy_score, classification_report
from sklearn.preprocessing import LabelEncoder

# ── Dynamic Path Anchoring ───────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATA_FILE   = os.path.join(BASE_DIR, "features_dataset.csv")
MODELS_FILE = os.path.join(BASE_DIR, "models.pkl")
# ────────────────────────────────────────────────────────────

FEATURE_COLS = [
    'rssi_s1', 'rssi_s2', 'rssi_s3', 'rssi_s4',
    'rel_s1',  'rel_s2',  'rel_s3',  'rel_s4',
    'rssi_std', 'rssi_range',
    'csi_mean', 'csi_std', 'csi_max', 'csi_min',
    'csi_range', 'csi_q25', 'csi_q75', 'csi_iqr', 'csi_skew',
    'ratio_s1_s2', 'ratio_s3_s4', 'ratio_s1_s4', 'ratio_s2_s3',
    'pos_left_right', 'pos_front_back',
]

COND_FEATS = ['rssi_mean_all', 'rssi_s1', 'rssi_s2', 'rssi_s3', 'rssi_s4']
RSSI_COLS  = ['rssi_s1', 'rssi_s2', 'rssi_s3', 'rssi_s4']
CONDITIONS = ['empty room', 'full room', 'half room moving']

def _add_derived(df):
    """Add relative RSSI and spread features."""
    df = df.copy()
    df['rssi_mean_all'] = df[RSSI_COLS].mean(axis=1)
    for c in RSSI_COLS:
        df[f'rel_{c}'] = df[c] - df['rssi_mean_all']
    df['rssi_std']   = df[RSSI_COLS].std(axis=1)
    df['rssi_range'] = df[RSSI_COLS].max(axis=1) - df[RSSI_COLS].min(axis=1)
    return df

def _temporal_split(group_df, train_ratio=0.75):
    """Split by TIME ORDER to prevent leaking consecutive window frames."""
    train_idx, test_idx = [], []
    for (_, _2), grp in group_df.groupby(['block', 'label']):
        idx = grp.index.tolist()
        cut = max(1, int(len(idx) * train_ratio))
        train_idx.extend(idx[:cut])
        test_idx.extend(idx[cut:])
    return group_df.loc[train_idx], group_df.loc[test_idx]

def _augment(train_df, n_copies=8, noise_std=1.5):
    """Augment data using random Gaussian RSSI variance."""
    aug = [train_df]
    for _ in range(n_copies):
        noisy = train_df.copy()
        noisy[RSSI_COLS] += np.random.normal(0, noise_std, size=(len(noisy), 4))
        noisy['rssi_mean_all'] = noisy[RSSI_COLS].mean(axis=1)
        for c in RSSI_COLS:
            noisy[f'rel_{c}'] = noisy[c] - noisy['rssi_mean_all']
        noisy['rssi_std']   = noisy[RSSI_COLS].std(axis=1)
        noisy['rssi_range'] = noisy[RSSI_COLS].max(axis=1) - noisy[RSSI_COLS].min(axis=1)
        aug.append(noisy)
    return pd.concat(aug, ignore_index=True)

def _get_available_features(df):
    return [c for c in FEATURE_COLS if c in df.columns]

def train_models():
    print("=" * 56)
    print("  MODEL.PY — Training localization models")
    print("=" * 56)

    print(f"\nLoading {DATA_FILE}...")
    try:
        df = pd.read_csv(DATA_FILE)
    except FileNotFoundError:
        print(f"ERROR: {DATA_FILE} not found. Run preprocess.py first!")
        return

    df['label'] = df['label'].replace({'half full moving': 'half room moving'})
    df = _add_derived(df)
    feature_cols = _get_available_features(df)

    le_block, le_cond = LabelEncoder(), LabelEncoder()
    df['block_enc'] = le_block.fit_transform(df['block'])
    df['cond_enc']  = le_cond.fit_transform(df['label'])

    train_df, test_df = _temporal_split(df)
    train_aug = _augment(train_df)

    # ── Stage 1: Room Condition ───────────────────────────
    cond_model = SVC(kernel='rbf', C=10, gamma='scale', probability=True, random_state=42)
    cond_model.fit(train_aug[COND_FEATS], train_aug['cond_enc'])

    # ── Stage 2: Block Models ─────────────────────────────
    block_models = {}
    for condition in CONDITIONS:
        sub = train_aug[train_aug['label'] == condition]
        if sub.empty:
            continue
        model = SVC(kernel='rbf', C=10, gamma='scale', class_weight='balanced', probability=True, random_state=42)
        model.fit(sub[feature_cols], sub['block_enc'])
        block_models[condition] = model

    # ── Save Pipeline ─────────────────────────────────────
    with open(MODELS_FILE, 'wb') as f:
        pickle.dump({
            'cond_model':    cond_model,
            'block_models':  block_models,
            'label_encoder': le_block,
            'cond_encoder':  le_cond,
            'feature_cols':  feature_cols,
            'cond_feats':    COND_FEATS,
        }, f)
    print(f"\nSaved to {MODELS_FILE}\n")

def predict_block(rssi_s1, rssi_s2, rssi_s3, rssi_s4, verbose=True, **kwargs):
    try:
        with open(MODELS_FILE, 'rb') as f:
            saved = pickle.load(f)
    except FileNotFoundError:
        return None, 0.0, None

    cond_model, block_models = saved['cond_model'], saved['block_models']
    le_block, le_cond = saved['label_encoder'], saved['cond_encoder']
    feature_cols, cond_feats = saved['feature_cols'], saved['cond_feats']

    rssi_vals = [rssi_s1, rssi_s2, rssi_s3, rssi_s4]
    rssi_mean, rssi_std = float(np.mean(rssi_vals)), float(np.std(rssi_vals))
    rssi_range = float(max(rssi_vals) - min(rssi_vals))
    abs_s = [abs(v) for v in rssi_vals]

    cond_input = pd.DataFrame([[rssi_mean, rssi_s1, rssi_s2, rssi_s3, rssi_s4]], columns=cond_feats)
    condition = le_cond.inverse_transform(cond_model.predict(cond_input))[0]

    all_feats = {
        'rssi_s1': rssi_s1, 'rssi_s2': rssi_s2, 'rssi_s3': rssi_s3, 'rssi_s4': rssi_s4,
        'rel_s1': rssi_s1 - rssi_mean, 'rel_s2': rssi_s2 - rssi_mean,
        'rel_s3': rssi_s3 - rssi_mean, 'rel_s4': rssi_s4 - rssi_mean,
        'rssi_std': rssi_std, 'rssi_range': rssi_range,
        'ratio_s1_s2': abs_s[0] / abs_s[1] if abs_s[1] != 0 else 0.0,
        'ratio_s3_s4': abs_s[2] / abs_s[3] if abs_s[3] != 0 else 0.0,
        'ratio_s1_s4': abs_s[0] / abs_s[3] if abs_s[3] != 0 else 0.0,
        'ratio_s2_s3': abs_s[1] / abs_s[2] if abs_s[2] != 0 else 0.0,
        'pos_left_right': (abs_s[0]+abs_s[2]) / (abs_s[1]+abs_s[3]) if (abs_s[1]+abs_s[3]) != 0 else 0.0,
        'pos_front_back': (abs_s[0]+abs_s[1]) / (abs_s[2]+abs_s[3]) if (abs_s[2]+abs_s[3]) != 0 else 0.0,
    }
    for k in FEATURE_COLS:
        if k not in all_feats:
            all_feats[k] = kwargs.get(k, 0.0)

    X = pd.DataFrame([all_feats])[feature_cols]
    pred_enc = block_models[condition].predict(X)[0]
    confidence = float(block_models[condition].predict_proba(X)[0].max() * 100)
    block_name = le_block.inverse_transform([pred_enc])[0]

    return block_name, confidence, condition

if __name__ == "__main__":
    train_models()
