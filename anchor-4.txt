#include <esp_now.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid     = "YOUR_WIFI_NAME";
const char* password = "YOUR_WIFI_PASSWORD";

const char* serverUrl = "http://192.168.1.XX:5000/upload";

#define WIFI_CHANNEL 7

typedef struct struct_message {
  char anchor_id[15];
  char mac_addr[18];
  int avg_rssi;
  int samples;
} struct_message;

struct_message myData;

int rssi_left   = -99;
int rssi_center = -99;
int rssi_right  = -99;

String trackedMac = "Waiting...";
unsigned long lastHttpSendTime = 0;

void OnDataRecv(const uint8_t * mac, const uint8_t *incomingData, int len) {
  memcpy(&myData, incomingData, sizeof(myData));

  Serial.print("Recv from: ");
  Serial.print(myData.anchor_id);
  Serial.print(" | RSSI: ");
  Serial.println(myData.avg_rssi);

  String id = String(myData.anchor_id);
  
  if (id == "Anchor_1") {
      rssi_left = myData.avg_rssi;
      trackedMac = String(myData.mac_addr);
  } 
  else if (id == "Anchor_2") {
      rssi_center = myData.avg_rssi;
  } 
  else if (id == "Anchor_3") {
      rssi_right = myData.avg_rssi;
  }
}

void setup() {
  Serial.begin(115200);

  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(ssid, password);
  
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected.");
  Serial.print("Gateway IP: ");
  Serial.println(WiFi.localIP());

  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    return;
  }
  
  esp_now_register_recv_cb(OnDataRecv);
  
  Serial.println("GATEWAY READY: Listening for Anchors...");
}

void loop() {
  if (millis() - lastHttpSendTime > 200) {
    if(WiFi.status() == WL_CONNECTED){
      
      HTTPClient http;
      http.begin(serverUrl);
      http.addHeader("Content-Type", "application/json");

      StaticJsonDocument<256> doc;
      doc["mac_address"] = trackedMac;
      doc["rssi_left"]   = rssi_left;
      doc["rssi_center"] = rssi_center;
      doc["rssi_right"]  = rssi_right;

      String requestBody;
      serializeJson(doc, requestBody);

      int httpResponseCode = http.POST(requestBody);

      if (httpResponseCode > 0) {
      } else {
        Serial.print("HTTP Error: ");
        Serial.println(httpResponseCode);
      }
      
      http.end();
    }
    else {
      Serial.println("WiFi Lost. Reconnecting...");
      WiFi.reconnect();
    }
    
    lastHttpSendTime = millis();
  }
}
