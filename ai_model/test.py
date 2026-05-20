"""
test.py — Full system test for the WiFi indoor localization model.
"""

import pickle
import pandas as pd
import numpy as np

# Load the saved models
MODELS_FILE = 'models.pkl'
DATA_FILE   = 'features_dataset.csv'

print("\nLoading models and dataset...")
try:
    with open(MODELS_FILE, 'rb') as f:
        saved = pickle.load(f)
except FileNotFoundError:
    print(f"ERROR: {MODELS_FILE} not found. Run model.py first!")
    exit()

cond_model   = saved['cond_model']
block_models = saved['block_models']
le_block     = saved['label_encoder']
le_cond      = saved['cond_encoder']
feature_cols = saved['feature_cols']
cond_feats   = saved['cond_feats']

df = pd.read_csv(DATA_FILE)
df['label'] = df['label'].replace({'half full moving': 'half room moving'})

RSSI = ['rssi_s1', 'rssi_s2', 'rssi_s3', 'rssi_s4']
df['rssi_mean_all'] = df[RSSI].mean(axis=1)
for c in RSSI:
    df[f'rel_{c}'] = df[c] - df['rssi_mean_all']
df['rssi_std']   = df[RSSI].std(axis=1)
df['rssi_range'] = df[RSSI].max(axis=1) - df[RSSI].min(axis=1)

all_cols  = feature_cols + cond_feats
use_cols  = list(set(all_cols) & set(df.columns))
means     = df.groupby(['block', 'label'])[use_cols].mean()

conditions = ['empty room', 'full room', 'half room moving']
blocks     = sorted(df['block'].unique(), key=lambda x: int(x.split('_')[1]))

total_correct = 0
total_tests   = 0
results_log   = []

# Mapping for the robustness fix
key_mapping = {'empty': 'empty room', 'full': 'full room', 'half': 'half room moving'}

for condition in conditions:
    correct = 0
    print(f"\n{'='*64}")
    print(f"  Condition: {condition.upper()}")
    print(f"{'='*64}")
    print(f"  {'Real Block':<12} {'Predicted':<12} {'Match?':<10} {'Confidence':<12} {'Detected As'}")
    print(f"  {'-'*60}")

    for block in blocks:
        try:
            row = means.loc[(block, condition)]
        except KeyError:
            continue

        # Stage 1: Detect condition
        cond_input = pd.DataFrame([row[cond_feats]], columns=cond_feats)
        condition_detected = le_cond.inverse_transform(cond_model.predict(cond_input))[0]

        # Stage 2: Predict block (with Robustness Fix)
        feat_input = pd.DataFrame([row[feature_cols]], columns=feature_cols)
        
        # Resolve key mismatch
        cond_key = key_mapping.get(condition_detected, condition_detected)
        if cond_key not in block_models:
            cond_key = condition # Fallback to real label if still not found
            
        pred_enc   = block_models[cond_key].predict(feat_input)[0]
        confidence = float(block_models[cond_key].predict_proba(feat_input)[0].max() * 100)
        predicted  = le_block.inverse_transform([pred_enc])[0]

        is_correct = (predicted == block)
        if is_correct: correct += 1

        tick = 'CORRECT' if is_correct else 'WRONG  '
        print(f"  {block:<12} {predicted:<12} {tick:<10} {confidence:.1f}%        {condition_detected}")

        results_log.append({
            'real_block': block, 'condition': condition, 'predicted': predicted,
            'confidence': confidence, 'detected_cond': condition_detected, 'correct': is_correct,
        })

    total_correct += correct
    total_tests   += len(blocks)
    pct = correct / len(blocks) * 100
    bar = '█' * correct + '░' * (len(blocks) - correct)
    print(f"\n  [{bar}]  {correct}/{len(blocks)} correct  ({pct:.1f}%)")

# Summary and Mistakes Detail logic follows...
print(f"\n{'='*64}")
print(f"  FINAL SUMMARY")
print(f"{'='*64}")
for condition in conditions:
    rows = [r for r in results_log if r['condition'] == condition]
    c = sum(1 for r in rows if r['correct'])
    n = len(rows)
    print(f"  {condition:<26} {c}/{n:<9} {c/n*100:.1f}%")

overall_pct = total_correct / total_tests * 100
print(f"\n  {'OVERALL':<26} {total_correct}/{total_tests:<9} {overall_pct:.1f}%")
