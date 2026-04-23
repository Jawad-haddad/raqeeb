from flask import Flask, request, jsonify
import csv
import os
from datetime import datetime

app = Flask(__name__)

CSV_FILE = "fingerprint_data_B5.csv"

CSV_HEADERS = [
    "received_at",
    "record_id",
    "mac_address",
    "bridge_uptime_ms",
    "block_label",
    "session_id",

    "a1_seen",
    "a1_avg_rssi",
    "a1_min_rssi",
    "a1_max_rssi",
    "a1_samples",
    "a1_seq_no",
    "a1_sniffer_uptime_ms",
    "a1_window_id",

    "a2_seen",
    "a2_avg_rssi",
    "a2_min_rssi",
    "a2_max_rssi",
    "a2_samples",
    "a2_seq_no",
    "a2_sniffer_uptime_ms",
    "a2_window_id",

    "a3_seen",
    "a3_avg_rssi",
    "a3_min_rssi",
    "a3_max_rssi",
    "a3_samples",
    "a3_seq_no",
    "a3_sniffer_uptime_ms",
    "a3_window_id",
]


def ensure_csv_exists() -> None:
    if not os.path.exists(CSV_FILE):
        with open(CSV_FILE, mode="w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(CSV_HEADERS)


def safe_get_anchor(anchor_data: dict | None, key: str, default=None):
    if not isinstance(anchor_data, dict):
        return default
    return anchor_data.get(key, default)


@app.route("/", methods=["GET"])
def home():
    return "Raqeeb Flask server is running."


@app.route("/upload", methods=["POST"])
def upload():
    data = request.get_json(silent=True)

    if not data:
        return jsonify({
            "status": "error",
            "message": "No valid JSON received"
        }), 400

    received_at = datetime.now().isoformat(timespec="seconds")
    record_id = data.get("record_id")
    mac_address = data.get("mac_address")
    bridge_uptime_ms = data.get("bridge_uptime_ms")

    # Optional metadata for labeling the dataset
    block_label = data.get("block_label", "BLOCK_5")
    session_id = data.get("session_id", "3:09 PM")

    anchor_1 = data.get("anchor_1", {})
    anchor_2 = data.get("anchor_2", {})
    anchor_3 = data.get("anchor_3", {})

    print("\n========== NEW SAMPLE RECEIVED ==========")
    print(f"Time: {received_at}")
    print(f"Record ID: {record_id}")
    print(f"MAC Address: {mac_address}")
    print(f"Bridge Uptime: {bridge_uptime_ms}")
    print(f"Block Label: {block_label}")
    print(f"Session ID: {session_id}")

    print("\nAnchor 1:")
    print(anchor_1)

    print("\nAnchor 2:")
    print(anchor_2)

    print("\nAnchor 3:")
    print(anchor_3)
    print("=========================================\n")

    row = [
        received_at,
        record_id,
        mac_address,
        bridge_uptime_ms,
        block_label,
        session_id,

        safe_get_anchor(anchor_1, "seen", False),
        safe_get_anchor(anchor_1, "avg_rssi", -99),
        safe_get_anchor(anchor_1, "min_rssi", -99),
        safe_get_anchor(anchor_1, "max_rssi", -99),
        safe_get_anchor(anchor_1, "samples", 0),
        safe_get_anchor(anchor_1, "seq_no", 0),
        safe_get_anchor(anchor_1, "sniffer_uptime_ms", 0),
        safe_get_anchor(anchor_1, "window_id", 0),

        safe_get_anchor(anchor_2, "seen", False),
        safe_get_anchor(anchor_2, "avg_rssi", -99),
        safe_get_anchor(anchor_2, "min_rssi", -99),
        safe_get_anchor(anchor_2, "max_rssi", -99),
        safe_get_anchor(anchor_2, "samples", 0),
        safe_get_anchor(anchor_2, "seq_no", 0),
        safe_get_anchor(anchor_2, "sniffer_uptime_ms", 0),
        safe_get_anchor(anchor_2, "window_id", 0),

        safe_get_anchor(anchor_3, "seen", False),
        safe_get_anchor(anchor_3, "avg_rssi", -99),
        safe_get_anchor(anchor_3, "min_rssi", -99),
        safe_get_anchor(anchor_3, "max_rssi", -99),
        safe_get_anchor(anchor_3, "samples", 0),
        safe_get_anchor(anchor_3, "seq_no", 0),
        safe_get_anchor(anchor_3, "sniffer_uptime_ms", 0),
        safe_get_anchor(anchor_3, "window_id", 0),
    ]

    ensure_csv_exists()

    with open(CSV_FILE, mode="a", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(row)

    return jsonify({
        "status": "success",
        "message": "Data received and saved",
        "record_id": record_id,
        "mac_address": mac_address,
        "block_label": block_label,
        "session_id": session_id
    }), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
