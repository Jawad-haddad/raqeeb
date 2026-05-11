import socket
import csv
import os
from datetime import datetime

UDP_IP = "0.0.0.0"
UDP_PORT = 12345
BUFFER_FLUSH_SIZE = 50

def start_collection():
    round_num = input("🎯 Enter Round Number (e.g., 1, 2, 3): ").strip()
    folder_name = f"Round_{round_num}"
    os.makedirs(folder_name, exist_ok=True)
    print(f"📁 Folder ready: {folder_name}/")

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    sock.settimeout(1.0)
    print(f"📡 Listening on UDP port {UDP_PORT}...\n")

    while True:
        print("-" * 50)
        block_num = input("📝 Block Number (1-12) or 'q' to quit: ").strip()
        if block_num.lower() == 'q':
            print("🏁 Finished Round. Exiting.")
            break

        label = input("🏷️  Label (e.g., normal, cheating, empty): ").strip()
        file_name = os.path.join(folder_name, f"Block_{block_num}_{label}.csv")

        with open(file_name, 'w', newline='') as f:
            csv.writer(f).writerow(
                ["laptop_timestamp", "sniffer_id", "esp_timestamp_us", "rssi", "csi_array", "label"]
            )

        print(f"▶️  Collecting → {file_name}")
        print("⏳ Press [Ctrl+C] to stop this block.\n")

        buffer = []
        packet_count = 0

        try:
            while True:
                try:
                    data, _ = sock.recvfrom(4096)
                    line = data.decode('utf-8').strip()

                    if not line.startswith("DATA"):
                        continue

                    # ESP32 format: DATA,sniffer_id,hall_code,timestamp_us,rssi,csi
                    parts = line.split(",", 5)
                    if len(parts) != 6:
                        continue

                    # parts[0]=DATA  parts[1]=sniffer_id  parts[2]=hall_code
                    # parts[3]=timestamp_us  parts[4]=rssi  parts[5]=csi
                    ts_laptop = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
                    buffer.append([ts_laptop, parts[1], parts[3], parts[4], parts[5], label])
                    packet_count += 1

                    if len(buffer) >= BUFFER_FLUSH_SIZE:
                        with open(file_name, 'a', newline='') as f:
                            csv.writer(f).writerows(buffer)
                        buffer.clear()
                        print(f"\r📦 Packets received: {packet_count}", end='', flush=True)

                except socket.timeout:
                    continue

        except KeyboardInterrupt:
            if buffer:
                with open(file_name, 'a', newline='') as f:
                    csv.writer(f).writerows(buffer)
            print(f"\n✅ Block {block_num} saved! Total packets: {packet_count} → {file_name}\n")

if __name__ == "__main__":
    start_collection()
