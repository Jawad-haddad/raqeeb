import os, pickle, pytest

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_FILE = os.path.join(BASE_DIR, "models.pkl")

def test_models_generation(): assert os.path.exists(MODELS_FILE)
def test_block_count():
    with open(MODELS_FILE, 'rb') as f: saved = pickle.load(f)
    assert len(saved['block_models']) == 3
def test_feature_integrity():
    with open(MODELS_FILE, 'rb') as f: saved = pickle.load(f)
    assert len(saved['feature_cols']) >= 4
def test_condition_detector():
    with open(MODELS_FILE, 'rb') as f: saved = pickle.load(f)
    assert 'cond_model' in saved
