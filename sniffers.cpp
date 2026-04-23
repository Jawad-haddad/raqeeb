#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_now.h>


uint8_t targetMac[] = {0x68, 0x13, 0x24, 0x5B, 0xF9, 0x42};

// Anchor_1 / Anchor_2 / Anchor_3
#define ANCHOR_NAME "Anchor_2"

#define WIFI_CHANNEL 11

// Bridge MAC
uint8_t receiverAddress[] = {0x30, 0xED, 0xA0, 0xA9, 0x73, 0x64};

// Send every 1 second
const unsigned long SEND_INTERVAL_MS = 1000;


typedef struct struct_message {
  char anchor_id[15];
  char mac_addr[18];

  int avg_rssi;
  int min_rssi;
  int max_rssi;
  int samples;

  unsigned long seq_no;

  // local ESP uptime 
  unsigned long uptime_ms;

  // synchronization window
  unsigned long window_id;

} struct_message;

struct_message myData;

volatile long rssiSum = 0;
volatile int packetCount = 0;
volatile int minRssi = 0;
volatile int maxRssi = 0;
volatile bool firstPacket = true;

unsigned long lastSendTime = 0;
unsigned long seqCounter = 0;
unsigned long windowCounter = 0;

portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;


bool macMatches(const uint8_t *candidate) {
  for (int i = 0; i < 6; i++) {
    if (candidate[i] != targetMac[i]) {
      return false;
    }
  }
  return true;
}

void OnDataSent(const wifi_tx_info_t *info, esp_now_send_status_t status) {
  Serial.print("ESP-NOW send status: ");
  Serial.println(status == ESP_NOW_SEND_SUCCESS ? "SUCCESS" : "FAIL");
}

void sniffer(void* buf, wifi_promiscuous_pkt_type_t type) {
  wifi_promiscuous_pkt_t* pkt = (wifi_promiscuous_pkt_t*)buf;

  if (pkt->rx_ctrl.rssi < -95) return;

  bool matchAt10 = macMatches(&pkt->payload[10]);
  bool matchAt16 = macMatches(&pkt->payload[16]);

  if (!matchAt10 && !matchAt16) return;

  portENTER_CRITICAL_ISR(&mux);

  int rssi = pkt->rx_ctrl.rssi;
  rssiSum += rssi;
  packetCount++;

  if (firstPacket) {
    minRssi = rssi;
    maxRssi = rssi;
    firstPacket = false;
  } else {
    if (rssi < minRssi) minRssi = rssi;
    if (rssi > maxRssi) maxRssi = rssi;
  }

  portEXIT_CRITICAL_ISR(&mux);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true, true);

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init failed");
    ESP.restart();
  }

  esp_now_register_send_cb(OnDataSent);

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, receiverAddress, 6);
  peerInfo.channel = WIFI_CHANNEL;
  peerInfo.encrypt = false;
  peerInfo.ifidx = WIFI_IF_STA;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("Failed to add bridge peer");
  }

  esp_wifi_set_promiscuous(false);
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous_rx_cb(&sniffer);
  esp_wifi_set_promiscuous(true);

  Serial.println("==================================");
  Serial.println("TIMESTAMPED SNIFFER STARTED");
  Serial.print("Anchor: ");
  Serial.println(ANCHOR_NAME);
  Serial.println("==================================");
}

void loop() {
  if (millis() - lastSendTime >= SEND_INTERVAL_MS) {

    long localSum = 0;
    int localCount = 0;
    int localMin = -99;
    int localMax = -99;
    bool hadPackets = false;

    portENTER_CRITICAL(&mux);

    if (packetCount > 0) {
      localSum = rssiSum;
      localCount = packetCount;
      localMin = minRssi;
      localMax = maxRssi;
      hadPackets = true;

      rssiSum = 0;
      packetCount = 0;
      firstPacket = true;
      minRssi = 0;
      maxRssi = 0;
    }

    portEXIT_CRITICAL(&mux);

    if (hadPackets) {

      memset(&myData, 0, sizeof(myData));

      strncpy(myData.anchor_id, ANCHOR_NAME, sizeof(myData.anchor_id) - 1);

      snprintf(myData.mac_addr, sizeof(myData.mac_addr),
               "%02X:%02X:%02X:%02X:%02X:%02X",
               targetMac[0], targetMac[1], targetMac[2],
               targetMac[3], targetMac[4], targetMac[5]);

      myData.avg_rssi = localSum / localCount;
      myData.min_rssi = localMin;
      myData.max_rssi = localMax;
      myData.samples = localCount;

      myData.seq_no = seqCounter++;

      myData.uptime_ms = millis();

      // synchronization
      myData.window_id = windowCounter++;

      esp_now_send(receiverAddress,
                   (uint8_t*)&myData,
                   sizeof(myData));

      Serial.println("---- REPORT ----");
      Serial.print("Anchor: "); Serial.println(myData.anchor_id);
      Serial.print("AVG RSSI: "); Serial.println(myData.avg_rssi);
      Serial.print("Samples: "); Serial.println(myData.samples);
      Serial.print("Uptime: "); Serial.println(myData.uptime_ms);
      Serial.print("Window ID: "); Serial.println(myData.window_id);
      Serial.println("----------------");
    }

    lastSendTime = millis();
  }
}
