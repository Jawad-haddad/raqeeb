"""
Unit tests for the Raqeeb Flask Backend.
Uses pytest and unittest.mock to simulate hardware inputs, network failures,
and ML model predictions to achieve 100% statement/branch coverage.
"""

import pytest
import time
import numpy as np
import pandas as pd
from unittest.mock import patch, MagicMock
import importlib

import server

@pytest.fixture(autouse=True)
def reset_server_state():
    # Clean up active devices between tests to prevent state leakage
    server.active_devices.clear()
    server.last_update_time = 0
    yield

@pytest.fixture
def client():
    server.app.config['TESTING'] = True
    with server.app.test_client() as client:
        yield client

def test_missing_model_fallback():
    # Simulate a missing models.pkl file to ensure the server falls back to threshold logic
    with patch('builtins.open') as mock_open:
        mock_open.side_effect = Exception("Simulated Corrupt File")
        importlib.reload(server) 
    assert server.ml_model is None

def test_csi_feature_extraction():
    assert server.compute_csi_features("10 20 -5 15") is not None
    assert server.compute_csi_features("10 20 -5") is not None 
    assert server.compute_csi_features("10") is None 
    assert server.compute_csi_features("invalid") is None 

def test_threshold_fallback_logic():
    assert server.threshold_predict(-40, -80, -90) == "Block_1"
    assert server.threshold_predict(-80, -40, -90) == "Block_2"
    assert server.threshold_predict(-80, -90, -40) == "Block_3"
    assert server.threshold_predict(-58, -80, -90) == "Block_4"
    assert server.threshold_predict(-70, -80, -90) == "Block_7"
    assert server.threshold_predict(-999, -999, -999) == "Unknown"

def test_anchor_filtering_and_stale_data():
    f = server.AnchorFilter()
    f.update("Anchor_1", -100) # Noise floor drop
    assert "Anchor_1" not in f.history
    
    f.update("Anchor_1", -50)
    with patch('time.time', return_value=time.time() + 10):
        assert f.get_value("Anchor_1") == -999 # Verify stale data is ignored
        
    assert f.get_value("Anchor_2") == -999
    assert f.get_last_seen_time() > 0

def test_zone_stabilization_voting():
    z = server.ZoneStabilizer()
    z.update("Block_1")
    
    # Flood history to trigger the most_common counter logic
    for _ in range(8): 
        z.update("Block_2") 
    assert z.displayed_zone == "Block_2"

def test_empty_dashboard_render(capsys):
    server.active_devices.clear()
    server.print_dashboard() 
    
    server.active_devices["test_mac"] = {
        "filter": server.AnchorFilter(), 
        "stabilizer": server.ZoneStabilizer(), 
        "ml_buffer": server.MLWindowBuffer()
    }
    server.print_dashboard() 
    
    server.active_devices["test_mac"]["filter"].last_seen["Anchor_1"] = time.time() - 10
    server.clean_old_devices()
    assert "test_mac" not in server.active_devices

@patch('server.ml_model')
def test_ml_pipeline_execution(mock_ml_model):
    # Mocking Scikit-Learn models and encoders
    mock_cond_model = MagicMock()
    mock_block_model = MagicMock()
    mock_le_cond = MagicMock()
    mock_le_block = MagicMock()
    
    mock_le_cond.inverse_transform.return_value = ["cond_1"]
    mock_le_block.inverse_transform.return_value = ["Block_1"]
    mock_block_model.predict.return_value = [0]
    mock_block_model.predict_proba.return_value = np.array([[0.1, 0.9]])
    
    server.ml_model = {
        'cond_model': mock_cond_model,
        'cond_encoder': mock_le_cond,
        'block_models': {'cond_1': mock_block_model},
        'label_encoder': mock_le_block,
        'feature_cols': [
            'rssi_s1', 'rssi_s2', 'rssi_s3', 'rssi_s4', 'rel_s1', 'rel_s2', 'rel_s3', 'rel_s4', 
            'rssi_std', 'rssi_range', 'csi_mean', 'csi_std', 'csi_max', 'csi_min', 'csi_range', 
            'csi_q25', 'csi_q75', 'csi_iqr', 'csi_skew', 'ratio_s1_s2', 'ratio_s3_s4', 
            'ratio_s1_s4', 'ratio_s2_s3', 'pos_left_right', 'pos_front_back'
        ],
        'cond_feats': ['rssi_mean', 's1', 's2', 's3', 's4']
    }

    b = server.MLWindowBuffer()
    assert b.add_packet(99, -50) is None 
    
   
    b.add_packet("Anchor_1", -50)
    with patch('time.time', return_value=time.time() + 15):
        assert b.add_packet("Anchor_1", -50) is None
        
    # Reset buffer for the rest of the test
    b.window_start = time.time()
    b.packets = {1: [], 2: [], 3: [], 4: []}
    # ----------------------

    # Simulate incoming packets over time to fill the buffer properly
    for _ in range(5): 
        b.add_packet("Anchor_1", -50, "10 20 30 40")
    
    # Force window expiration with enough packets
    with patch('time.time', return_value=time.time() + 15):
        res = b.add_packet("Anchor_2", -60)
        assert res is not None

    # Test math fallback branches with zeroes
    block, conf, cond = server.ml_predict(0, 0, 0, 0, csi=None)
    assert block == "Block_1"
    server.ml_model = None

def test_malformed_udp_packets():
    server.process_udp_packet("NOT_DATA_AT_ALL") 
    server.process_udp_packet("DATA,1,123") 
    server.process_udp_packet("DATA,99,123456,-50") 
    server.process_udp_packet("DATA,apple,123456,-50") 
    
    for _ in range(5): 
        server.process_udp_packet("DATA,1,123,-50,10 20")
    
    with patch('time.time', return_value=time.time() + 15):
        server.process_udp_packet("DATA,1,123,-50,10 20")

@patch('socket.socket')
def test_socket_listener_crash_recovery(mock_socket):
    mock_sock = MagicMock()
    mock_socket.return_value = mock_sock
    
    # Simulate valid data, followed by a crash, followed by an exit
    mock_sock.recvfrom.side_effect = [
        (b"DATA,1,1234,-50", ("127.0.0.1", 12345)),
        Exception("Simulated socket crash!"), 
        KeyboardInterrupt()
    ]
    
    with pytest.raises(KeyboardInterrupt):
        server.udp_listener()

def test_api_upload_endpoint(client):
    # Test error handling
    assert client.post('/upload', data="Bad JSON").status_code == 500
    assert client.post('/upload', json={"mac_addr": server.TARGET_MAC, "anchor_id": "Anchor_1", "avg_rssi": "apple"}).status_code == 400

    # Test successful data ingestion pipeline
    payload = {"mac_addr": server.TARGET_MAC, "anchor_id": "Anchor_1", "avg_rssi": -50}
    for _ in range(5):
        client.post('/upload', json=payload)
        
    with patch('time.time', return_value=time.time() + 15):
        res = client.post('/upload', json=payload)
        assert res.status_code == 200
        assert res.get_json()["status"] == "OK"