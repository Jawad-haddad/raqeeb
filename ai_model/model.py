import pandas as pd
import numpy as np
import pickle
from sklearn.svm import SVC
from sklearn.metrics import accuracy_score, classification_report
from sklearn.preprocessing import LabelEncoder

DATA_FILE   = "features_dataset.csv"
MODELS_FILE = "models.pkl"

# Features used for block prediction
FEATURE_COLS = [
    'rssi_s1', 'rssi_s2', 'rssi_s3', 'rssi_s4',
    'rel_s1',  'rel_s2',  'rel_s3',  'rel_s4',
    'rssi_std', 'rssi_range',
    'csi_mean', 'csi_std', 'csi_max', 'csi_min',
    'csi_range', 'csi_q25', 'csi_q75', 'csi_iqr', 'csi_skew',
    'ratio_s1_s2', 'ratio_s3_s4', 'ratio_s1_s4', 'ratio_s2_s3',
    'pos_left_right', 'pos_front_back',
]

# Features used to detect room condition (empty / full / moving)
COND_FEATS = ['rssi_mean_all', 'rssi_s1', 'rssi_s2', 'rssi_s3', 'rssi_s4']

RSSI_COLS  = ['rssi_s1', 'rssi_s2', 'rssi_s3', 'rssi_s4']
CONDITIONS = ['empty room', 'full room', 'half room moving']


# ─────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────

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
    """
    Split by TIME ORDER — not randomly.
    First 75% of each (block, condition) session → train.
    Last  25% → test.
    Prevents leakage from near-identical consecutive windows.
    """
    train_idx, test_idx = [], []
    for (_, _2), grp in group_df.groupby(['block', 'label']):
        idx = grp.index.tolist()
        cut = max(1, int(len(idx) * train_ratio))
        train_idx.extend(idx[:cut])
        test_idx.extend(idx[cut:])
    return group_df.loc[train_idx], group_df.loc[test_idx]


def _augment(train_df, n_copies=8, noise_std=1.5):
    """
    Create augmented copies with small RSSI noise.
    Simulates different student devices and day-to-day variation.
    """
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
    """Return only feature columns that exist in this CSV."""
    return [c for c in FEATURE_COLS if c in df.columns]


# ─────────────────────────────────────────────────────────
# Training
# ─────────────────────────────────────────────────────────

def train_models():
    print("=" * 56)
    print("  MODEL.PY — Training localization models")
    print("=" * 56)

    print(f"\nLoading {DATA_FILE}...")
    try:
        df = pd.read_csv(DATA_FILE)
    except FileNotFoundError:
        print(f"ERROR: {DATA_FILE} not found.")
        print("Run preprocess.py first!")
        return

    # Fix label naming inconsistency across rounds
    df['label'] = df['label'].replace({'half full moving': 'half room moving'})
    df = _add_derived(df)

    feature_cols = _get_available_features(df)

    le_block = LabelEncoder()
    le_cond  = LabelEncoder()
    df['block_enc'] = le_block.fit_transform(df['block'])
    df['cond_enc']  = le_cond.fit_transform(df['label'])

    print(f"Total windows : {len(df)}")
    print(f"Blocks        : {df['block'].nunique()}")
    print(f"Features      : {len(feature_cols)}")
    print(f"Conditions    : {df['label'].unique().tolist()}\n")

    train_df, test_df = _temporal_split(df)
    train_aug = _augment(train_df)
    print(f"Train: {len(train_df)} windows  (+{len(train_aug)-len(train_df)} augmented)")
    print(f"Test : {len(test_df)} windows\n")

    # ── Stage 1: condition detector ──────────────────────
    print("=" * 56)
    print("  Stage 1 — Auto-detect room condition")
    print("  (empty room / full room / half room moving)")
    print("=" * 56)

    cond_model = SVC(
        kernel='rbf', C=10, gamma='scale',
        probability=True, random_state=42
    )
    cond_model.fit(train_aug[COND_FEATS], train_aug['cond_enc'])

    cond_acc = accuracy_score(
        test_df['cond_enc'],
        cond_model.predict(test_df[COND_FEATS])
    )
    print(f"  Condition detection accuracy: {cond_acc*100:.1f}%\n")

    # ── Stage 2: one block model per condition ────────────
    print("=" * 56)
    print("  Stage 2 — Block prediction (one model per condition)")
    print("=" * 56)

    block_models = {}
    for condition in CONDITIONS:
        sub = train_aug[train_aug['label'] == condition]
        if sub.empty:
            print(f"\n  Skipping '{condition}' — no training data.")
            continue

        model = SVC(
            kernel='rbf', C=10, gamma='scale',
            class_weight='balanced',
            probability=True, random_state=42
        )
        model.fit(sub[feature_cols], sub['block_enc'])
        block_models[condition] = model

        te = test_df[test_df['label'] == condition]
        if len(te) > 0:
            y_pred = model.predict(te[feature_cols])
            acc    = accuracy_score(te['block_enc'], y_pred)
            names  = le_block.inverse_transform(sorted(te['block_enc'].unique()))
            print(f"\n  {condition.upper()}")
            print(f"  Accuracy: {acc*100:.1f}%")
            print(classification_report(
                te['block_enc'], y_pred,
                target_names=names, zero_division=0
            ))

    # ── Full pipeline score ───────────────────────────────
    correct = 0
    for _, row in test_df.iterrows():
        cond_enc  = cond_model.predict(
            pd.DataFrame([row[COND_FEATS]], columns=COND_FEATS)
        )[0]
        cond      = le_cond.inverse_transform([cond_enc])[0]
        block_enc = block_models[cond].predict(
            pd.DataFrame([row[feature_cols]], columns=feature_cols)
        )[0]
        if block_enc == row['block_enc']:
            correct += 1

    print("=" * 56)
    print(f"  FULL PIPELINE — no condition needed: {correct/len(test_df)*100:.1f}%")
    print("=" * 56)

    # ── Save ──────────────────────────────────────────────
    with open(MODELS_FILE, 'wb') as f:
        pickle.dump({
            'cond_model':    cond_model,
            'block_models':  block_models,
            'label_encoder': le_block,
            'cond_encoder':  le_cond,
            'feature_cols':  feature_cols,
            'cond_feats':    COND_FEATS,
        }, f)

    print(f"\nSaved to {MODELS_FILE}")
    print("Ready — use predict_block(s1, s2, s3, s4) to predict.\n")


# ─────────────────────────────────────────────────────────
# Prediction
# ─────────────────────────────────────────────────────────

def predict_block(rssi_s1, rssi_s2, rssi_s3, rssi_s4,
                  csi_mean=0.0, csi_std=0.0,  csi_max=0.0,
                  csi_min=0.0,  csi_range=0.0, csi_q25=0.0,
                  csi_q75=0.0,  csi_iqr=0.0,  csi_skew=0.0,
                  verbose=True):
    """
    Predict which block a device is in.

    The room condition is detected AUTOMATICALLY — you never specify it.
    Works for empty room, full exam room, students moving, and hybrid.

    Required arguments:
        rssi_s1, rssi_s2, rssi_s3, rssi_s4
            Live RSSI readings from each sniffer (negative dBm values, e.g. -62.5)

    Optional arguments:
        csi_*    CSI features from the same 10-second window (leave at 0 if unavailable)
        verbose  Set to False to suppress printed output

    Returns:
        (block_name, confidence, detected_condition)
        e.g. ('Block_7', 84.3, 'full room')

    Example:
        predict_block(-62.8, -59.6, -49.6, -67.5)
    """
    try:
        with open(MODELS_FILE, 'rb') as f:
            saved = pickle.load(f)
    except FileNotFoundError:
        print(f"ERROR: {MODELS_FILE} not found. Run model.py first!")
        return None, 0.0, None

    cond_model   = saved['cond_model']
    block_models = saved['block_models']
    le_block     = saved['label_encoder']
    le_cond      = saved['cond_encoder']
    feature_cols = saved['feature_cols']
    cond_feats   = saved['cond_feats']

    rssi_vals  = [rssi_s1, rssi_s2, rssi_s3, rssi_s4]
    rssi_mean  = float(np.mean(rssi_vals))
    rssi_std   = float(np.std(rssi_vals))
    rssi_range = float(max(rssi_vals) - min(rssi_vals))
    abs_s      = [abs(v) for v in rssi_vals]

    # ── Stage 1: detect condition ─────────────────────────
    cond_input = pd.DataFrame(
        [[rssi_mean, rssi_s1, rssi_s2, rssi_s3, rssi_s4]],
        columns=cond_feats
    )
    condition = le_cond.inverse_transform(cond_model.predict(cond_input))[0]

    # ── Stage 2: predict block ────────────────────────────
    all_feats = {
        'rssi_s1': rssi_s1,   'rssi_s2': rssi_s2,
        'rssi_s3': rssi_s3,   'rssi_s4': rssi_s4,
        'rel_s1':  rssi_s1 - rssi_mean,
        'rel_s2':  rssi_s2 - rssi_mean,
        'rel_s3':  rssi_s3 - rssi_mean,
        'rel_s4':  rssi_s4 - rssi_mean,
        'rssi_std':   rssi_std,
        'rssi_range': rssi_range,
        'csi_mean':  csi_mean,  'csi_std':  csi_std,
        'csi_max':   csi_max,   'csi_min':  csi_min,
        'csi_range': csi_range, 'csi_q25':  csi_q25,
        'csi_q75':   csi_q75,   'csi_iqr':  csi_iqr,
        'csi_skew':  csi_skew,
        'ratio_s1_s2': abs_s[0] / abs_s[1] if abs_s[1] != 0 else 0.0,
        'ratio_s3_s4': abs_s[2] / abs_s[3] if abs_s[3] != 0 else 0.0,
        'ratio_s1_s4': abs_s[0] / abs_s[3] if abs_s[3] != 0 else 0.0,
        'ratio_s2_s3': abs_s[1] / abs_s[2] if abs_s[2] != 0 else 0.0,
        'pos_left_right': (abs_s[0]+abs_s[2]) / (abs_s[1]+abs_s[3])
                           if (abs_s[1]+abs_s[3]) != 0 else 0.0,
        'pos_front_back': (abs_s[0]+abs_s[1]) / (abs_s[2]+abs_s[3])
                           if (abs_s[2]+abs_s[3]) != 0 else 0.0,
    }

    X          = pd.DataFrame([all_feats])[feature_cols]
    pred_enc   = block_models[condition].predict(X)[0]
    confidence = float(block_models[condition].predict_proba(X)[0].max() * 100)
    block_name = le_block.inverse_transform([pred_enc])[0]

    if verbose:
        print(f"Detected condition : {condition}")
        print(f"Predicted block    : {block_name}")
        print(f"Confidence         : {confidence:.1f}%")

    return block_name, confidence, condition


if __name__ == "__main__":
    train_models()
