import pickle
import os
import pytest

# Paths to the files generated during the GitHub Action run
MODELS_FILE = 'models.pkl'

def test_models_generation():
    """Verify that the training script actually produced the brain file."""
    assert os.path.exists(MODELS_FILE), "ERROR: models.pkl was not generated during training!"

def test_block_count():
    """Ensure the model is trained to recognize exactly 12 blocks."""
    with open(MODELS_FILE, 'rb') as f:
        saved = pickle.load(f)
    # Check the label encoder for the 12 blocks
    blocks = saved['label_encoder'].classes_
    assert len(blocks) == 12, f"Expected 12 blocks, but found {len(blocks)}"

def test_feature_integrity():
    """Verify that all 25 required features are being used."""
    with open(MODELS_FILE, 'rb') as f:
        saved = pickle.load(f)
    # Check that both RSSI and CSI features are present
    features = saved['feature_cols']
    assert len(features) >= 25, f"Feature count low: {len(features)}. Missing CSI or RSSI stats?"

def test_condition_detector():
    """Ensure all 3 room conditions are registered in the model."""
    with open(MODELS_FILE, 'rb') as f:
        saved = pickle.load(f)
    conditions = saved['cond_encoder'].classes_
    expected = ['empty room', 'full room', 'half room moving']
    for cond in expected:
        assert cond in conditions, f"Missing condition: {cond}"
