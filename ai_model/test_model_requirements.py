import os
import pickle
import pytest

# ── Dynamic Path Anchoring ───────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_FILE = os.path.join(BASE_DIR, "models.pkl")
# ────────────────────────────────────────────────────────────

def test_models_generation():
    assert os.path.exists(MODELS_FILE), f"ERROR: models.pkl was not found at {MODELS_FILE}!"

def test_block_count():
    with open(MODELS_FILE, 'rb') as f:
        saved = pickle.load(f)
    assert 'block_models' in saved, "Key 'block_models' missing from generated pickle!"
    assert len(saved['block_models']) == 3, f"Expected 3 condition block models, found {len(saved['block_models'])}"

def test_feature_integrity():
    with open(MODELS_FILE, 'rb') as f:
        saved = pickle.load(f)
    assert 'feature_cols' in saved, "Key 'feature_cols' missing from generated pickle!"
    assert len(saved['feature_cols']) >= 4, "Model needs to evaluate at least the 4 primary RSSI components!"

def test_condition_detector():
    with open(MODELS_FILE, 'rb') as f:
        saved = pickle.load(f)
    assert 'cond_model' in saved, "Stage 1 condition detector algorithm missing from pickle structural tree!"
