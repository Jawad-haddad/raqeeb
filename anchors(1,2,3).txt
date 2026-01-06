#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_now.h>

uint8_t targetMac[] = {0x28, 0xC2, 0x1F, 0xEC, 0x23, 0x1A};

#define ANCHOR_NAME "Anchor_1"

#define WIFI_CHANNEL 7

uint8_t receiverAddress[] = {0x30, 0xED, 0xA0, 0xA9, 0x73, 0x64};

typedef struct struct_message {
  char anchor_id[15];
  char mac_addr[18];
  int avg_rssi;
  int samples;
} struct_message;

struct_message myData;

long rssiBucket = 0;
int packetCount = 0;
unsigned long lastSendTime = 0;

void sniffer(void* buf, wifi_promiscuous_pkt_type_t type) {
  wifi_promiscuous_pkt_t* pkt = (wifi_promiscuous_pkt_t*)buf;
  
  if (pkt->rx_ctrl.rssi < -95) return;

  for (int i = 0; i < 6; i++) {
    if (pkt->payload[10 + i] != targetMac[i]) {
      return;
    }
  }

  rssiBucket += pkt->rx_ctrl.rssi;
  packetCount++;
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  if (esp_now_init() != ESP_OK) ESP.restart();

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, receiverAddress, 6);
  peerInfo.channel = WIFI_CHANNEL;
  peerInfo.encrypt = false;
  peerInfo.ifidx = WIFI_IF_STA;
  
  if (esp_now_add_peer(&peerInfo) != ESP_OK){
    Serial.println("Failed to add peer");
  }

  esp_wifi_set_promiscuous(true);
  esp_wifi_set_promiscuous_rx_cb(&sniffer);
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  
  Serial.println("SMART FILTER STARTED: Tracking specific MAC only.");
}

void loop() {
  if (millis() - lastSendTime > 100) {
    if (packetCount > 0) {
      strcpy(myData.anchor_id, ANCHOR_NAME);
      
      snprintf(myData.mac_addr, 18, "%02x:%02x:%02x:%02x:%02x:%02x",
               targetMac[0], targetMac[1], targetMac[2], 
               targetMac[3], targetMac[4], targetMac[5]);
               
      myData.avg_rssi = rssiBucket / packetCount;
      myData.samples = packetCount;

      esp_now_send(receiverAddress, (uint8_t *) &myData, sizeof(myData));
      
      rssiBucket = 0;
      packetCount = 0;
    }
    
    lastSendTime = millis();
  }
}
