from flask import Flask, request, jsonify
from flask_cors import CORS
from collections import deque, Counter
import statistics
import time
import logging
import sys
import os
from supabase import create_client, Client

# ==========================================
#                  CONFIGURATION
# ==========================================

TARGET_MAC = "28:c2:1f:ec:23:1a"

# SYSTEM TUNING
MAX_STALE_SECONDS = 4.0
NOISE_FLOOR       = -95
UPDATE_INTERVAL   = 0.2

# Filter & Stabilization
FILTER_WINDOW_SIZE = 15
STABILIZATION_COUNT = 8

# CALIBRATION (Matches your snippet)
OFFSET_LEFT   = 0
OFFSET_CENTER = 0
OFFSET_RIGHT  = 0

# THRESHOLDS (Matches your snippet)
THRESH_FRONT  = -55
THRESH_MIDDLE = -60

# ==========================================
#             SUPABASE SETUP
# ==========================================
SUPABASE_URL = "https://txbmdnhoyxsckdnbeggw.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4Ym1kbmhveXhzY2tkbmJlZ2d3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0NzQyNjcsImV4cCI6MjA3OTA1MDI2N30.oe1IxHQLvAx176ieo5AccwkE9IAbs6c7SkuagETC4cY"

# Initialize Supabase
supabase = None
try:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("✅ Connected to Supabase!")
except Exception as e:
    print(f"❌ Supabase Connection Failed: {e}")

# ==========================================
#               SERVER LOGIC
# ==========================================

log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

app = Flask(__name__)
CORS(app)

class AnchorFilter:
    def __init__(self):
        self.history = {}
        self.last_seen = {}

    def update(self, anchor_id, rssi):
        if rssi < NOISE_FLOOR: return
        current_time = time.time()

        if anchor_id not in self.history:
            self.history[anchor_id] = deque(maxlen=FILTER_WINDOW_SIZE)

        self.history[anchor_id].append(rssi)
        self.last_seen[anchor_id] = current_time

    def get_value(self, anchor_id):
        if anchor_id not in self.history or len(self.history[anchor_id]) == 0:
            return -999

        if time.time() - self.last_seen.get(anchor_id, 0) > MAX_STALE_SECONDS:
            return -999

        return statistics.median(list(self.history[anchor_id]))

    def get_last_seen_time(self):
        if not self.last_seen: return 0
        return max(self.last_seen.values())

class ZoneStabilizer:
    def __init__(self):
        self.history = deque(maxlen=STABILIZATION_COUNT)
        self.displayed_zone = "Unknown"

    def update(self, new_zone):
        self.history.append(new_zone)

        if len(self.history) == STABILIZATION_COUNT:
            counts = Counter(self.history)
            most_common, count = counts.most_common(1)[0]

            if count > (STABILIZATION_COUNT / 2):
                self.displayed_zone = most_common

        if self.displayed_zone == "Unknown" and len(self.history) > 0:
             self.displayed_zone = self.history[-1]

        return self.displayed_zone

active_devices = {}
last_update_time = 0

def identify_block_logic(val_left, val_center, val_right):
    adj_left   = (val_left   + OFFSET_LEFT)   if val_left   != -999 else -999
    adj_center = (val_center + OFFSET_CENTER) if val_center != -999 else -999
    adj_right  = (val_right  + OFFSET_RIGHT)  if val_right  != -999 else -999

    candidates = [(adj_left, "Left"), (adj_center, "Center"), (adj_right, "Right")]
    best = max(candidates, key=lambda x: x[0])
    strongest_rssi = best[0]
    col = best[1]

    if strongest_rssi == -999: return "Unknown"

    if strongest_rssi > THRESH_FRONT:
        row = "Front"
    elif strongest_rssi > THRESH_MIDDLE:
        row = "Middle"
    else:
        row = "Back"

    mapping = {
        "Front":  {"Left": "Block 1", "Center": "Block 2", "Right": "Block 3"},
        "Middle": {"Left": "Block 4", "Center": "Block 5", "Right": "Block 6"},
        "Back":   {"Left": "Block 7", "Center": "Block 8", "Right": "Block 9"}
    }

    return mapping[row].get(col, "Calculating...")

def clean_old_devices():
    current_time = time.time()
    to_remove = []
    for mac, info in active_devices.items():
        if current_time - info["filter"].get_last_seen_time() > MAX_STALE_SECONDS:
            to_remove.append(mac)
    for mac in to_remove:
        del active_devices[mac]

# --- UPDATED HELPER: Send to DB with Block Number ---
def push_to_db(anchor_id, rssi, mac_addr, current_zone):
    """Sends data to Supabase 'espData' table with the real block number."""
    if supabase is None:
        return

    # Extract the number from "Block 4" -> 4
    block_num = 0
    if current_zone and "Block" in current_zone:
        try:
            block_num = int(current_zone.split(" ")[1])
        except:
            block_num = 0

    data_payload = {
        "anchor_id": anchor_id,
        "rssi": rssi,
        "mac": mac_addr,
        "ssid": "Targeted Device",
        "block_number": block_num  # <--- Now uses the calculated number
    }
    try:
        supabase.table("espData").insert(data_payload).execute()
    except Exception as e:
        print(f"⚠️ DB Error: {e}")

def print_dashboard():
    os.system('cls' if os.name == 'nt' else 'clear')

    print("=" * 70)
    print(f"{'MAC ADDRESS':<20} | {'LOCATION':<10} | {'RAW L':<6} | {'RAW C':<6} | {'RAW R':<6}")
    print("-" * 70)

    sorted_devs = sorted(active_devices.items(),
                         key=lambda x: x[1]["filter"].get_value("Anchor_2"),
                         reverse=True)

    for mac, info in sorted_devs:
        f = info["filter"]
        stabilizer = info["stabilizer"]

        l, c, r = f.get_value("Anchor_1"), f.get_value("Anchor_2"), f.get_value("Anchor_3")

        if l == -999 and c == -999 and r == -999: continue

        calculated_zone = identify_block_logic(l, c, r)
        final_zone = stabilizer.update(calculated_zone)

        d_l = f"{l:.0f}" if l > -900 else "--"
        d_c = f"{c:.0f}" if c > -900 else "--"
        d_r = f"{r:.0f}" if r > -900 else "--"

        print(f"{mac:<20} | {final_zone:<10} | {d_l:<6} | {d_c:<6} | {d_r:<6}")

    print("=" * 70)
    print(f"Calibration: L={OFFSET_LEFT}, C={OFFSET_CENTER}, R={OFFSET_RIGHT}")
    print(f"Thresholds:  Front > {THRESH_FRONT}, Middle > {THRESH_MIDDLE}")

@app.route("/upload", methods=["POST"])
def upload():
    global last_update_time
    try:
        data = request.get_json()
        mac = data.get("mac_addr") or data.get("mac") or data.get("ssid")
        anchor = data.get("anchor_id") or data.get("anchor")
        rssi = data.get("avg_rssi") or data.get("rssi")

        if mac and mac.lower() == TARGET_MAC.lower():
            if mac not in active_devices:
                active_devices[mac] = {
                    "filter": AnchorFilter(),
                    "stabilizer": ZoneStabilizer()
                }

            if anchor and rssi:
                # 1. Update Local Filter
                active_devices[mac]["filter"].update(anchor, int(rssi))

                # 2. Grab the current zone (from previous calculation)
                current_zone = active_devices[mac]["stabilizer"].displayed_zone

                # 3. Send to Supabase with the Zone!
                push_to_db(anchor, int(rssi), mac, current_zone)

            curr = time.time()
            if curr - last_update_time > UPDATE_INTERVAL:
                clean_old_devices()
                print_dashboard()
                last_update_time = curr

        return jsonify({"status": "OK"}), 200
    except Exception as e:
        return jsonify({"status": "ERR", "msg": str(e)}), 500

if __name__ == "__main__":
    print(f"--- SERVER STARTED (STABILIZED + SUPABASE) ---")
    app.run(host="0.0.0.0", port=5000)