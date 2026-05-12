import pickle
import os
import pytest

MODELS_FILE = 'models.pkl'

def test_models_generation():
    assert os.path.exists(MODELS_FILE), "ERROR: models.pkl was not generated during training!"

def test_block_count():
    with open(MODELS_FILE, 'rb') as f:
        saved = pickle.load(f)
    blocks = saved['label_encoder'].classes_
    assert len(blocks) == 12, f"Expected 12 blocks, but found {len(blocks)}"

def test_feature_integrity():
    with open(MODELS_FILE, 'rb') as f:
        saved = pickle.load(f)
    features = saved['feature_cols']
    assert len(features) >= 25, f"Feature count low: {len(features)}. Missing CSI or RSSI stats?"

def test_condition_detector():
    with open(MODELS_FILE, 'rb') as f:
        saved = pickle.load(f)
    conditions = saved['cond_encoder'].classes_
    expected = ['empty room', 'full room', 'half room moving']
    for cond in expected:
        assert cond in conditions, f"Missing condition: {cond}"
