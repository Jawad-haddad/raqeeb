#include <esp_now.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid     = "Umniah-F942";
const char* password = "FFD7YAM5";

const char* serverUrl = "http://192.168.8.106
:5000/upload";

#define WIFI_CHANNEL 11
const unsigned long HTTP_SEND_INTERVAL_MS = 1000;

typedef struct struct_message {
  char anchor_id[15];
  char mac_addr[18];

  int avg_rssi;
  int min_rssi;
  int max_rssi;
  int samples;

  unsigned long seq_no;
  unsigned long uptime_ms;
  unsigned long window_id;
} struct_message;

struct_message incomingData;

struct AnchorReading {
  bool seen;
  int avg_rssi;
  int min_rssi;
  int max_rssi;
  int samples;
  unsigned long seq_no;
  unsigned long uptime_ms;
  unsigned long window_id;
  unsigned long last_update_ms;
};

AnchorReading anchor1 = {false, -99, -99, -99, 0, 0, 0, 0, 0};
AnchorReading anchor2 = {false, -99, -99, -99, 0, 0, 0, 0, 0};
AnchorReading anchor3 = {false, -99, -99, -99, 0, 0, 0, 0, 0};

String trackedMac = "Waiting...";
unsigned long lastHttpSendTime = 0;
unsigned long recordId = 0;

void OnDataRecv(const esp_now_recv_info* info, const uint8_t* data, int len) {
  if (len != sizeof(struct_message)) {
    Serial.print("Received unexpected packet size. Got: ");
    Serial.print(len);
    Serial.print(" Expected: ");
    Serial.println(sizeof(struct_message));
    return;
  }

  memcpy(&incomingData, data, sizeof(incomingData));

  String id = String(incomingData.anchor_id);
  trackedMac = String(incomingData.mac_addr);

  Serial.println("==== ESP-NOW RX ====");
  Serial.print("From anchor: "); Serial.println(id);
  Serial.print("MAC: "); Serial.println(trackedMac);
  Serial.print("AVG RSSI: "); Serial.println(incomingData.avg_rssi);
  Serial.print("MIN RSSI: "); Serial.println(incomingData.min_rssi);
  Serial.print("MAX RSSI: "); Serial.println(incomingData.max_rssi);
  Serial.print("SAMPLES: "); Serial.println(incomingData.samples);
  Serial.print("SEQ: "); Serial.println(incomingData.seq_no);
  Serial.print("UPTIME: "); Serial.println(incomingData.uptime_ms);
  Serial.print("WINDOW ID: "); Serial.println(incomingData.window_id);
  Serial.println("====================");

  unsigned long nowMs = millis();

  if (id == "Anchor_1") {
    anchor1.seen = true;
    anchor1.avg_rssi = incomingData.avg_rssi;
    anchor1.min_rssi = incomingData.min_rssi;
    anchor1.max_rssi = incomingData.max_rssi;
    anchor1.samples = incomingData.samples;
    anchor1.seq_no = incomingData.seq_no;
    anchor1.uptime_ms = incomingData.uptime_ms;
    anchor1.window_id = incomingData.window_id;
    anchor1.last_update_ms = nowMs;
  }
  else if (id == "Anchor_2") {
    anchor2.seen = true;
    anchor2.avg_rssi = incomingData.avg_rssi;
    anchor2.min_rssi = incomingData.min_rssi;
    anchor2.max_rssi = incomingData.max_rssi;
    anchor2.samples = incomingData.samples;
    anchor2.seq_no = incomingData.seq_no;
    anchor2.uptime_ms = incomingData.uptime_ms;
    anchor2.window_id = incomingData.window_id;
    anchor2.last_update_ms = nowMs;
  }
  else if (id == "Anchor_3") {
    anchor3.seen = true;
    anchor3.avg_rssi = incomingData.avg_rssi;
    anchor3.min_rssi = incomingData.min_rssi;
    anchor3.max_rssi = incomingData.max_rssi;
    anchor3.samples = incomingData.samples;
    anchor3.seq_no = incomingData.seq_no;
    anchor3.uptime_ms = incomingData.uptime_ms;
    anchor3.window_id = incomingData.window_id;
    anchor3.last_update_ms = nowMs;
  }
}

void resetAnchorWindow(AnchorReading &a) {
  a.seen = false;
  a.avg_rssi = -99;
  a.min_rssi = -99;
  a.max_rssi = -99;
  a.samples = 0;
  a.seq_no = 0;
  a.uptime_ms = 0;
  a.window_id = 0;
  a.last_update_ms = 0;
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected.");
  Serial.print("Bridge IP: ");
  Serial.println(WiFi.localIP());

  Serial.print("Bridge MAC Address: ");
  Serial.println(WiFi.macAddress());

  Serial.print("Router Channel: ");
  Serial.println(WiFi.channel());

  if (WiFi.channel() != WIFI_CHANNEL) {
    Serial.println("WARNING: Router channel does not match WIFI_CHANNEL!");
  }

  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);

  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    return;
  }

  esp_now_register_recv_cb(OnDataRecv);

  Serial.println("==================================");
  Serial.println("BRIDGE READY: Listening for Anchors");
  Serial.println("==================================");
}

void loop() {
  if (millis() - lastHttpSendTime >= HTTP_SEND_INTERVAL_MS) {
    if (WiFi.status() == WL_CONNECTED) {
      bool anySeen = anchor1.seen || anchor2.seen || anchor3.seen;

      if (anySeen) {
        HTTPClient http;
        http.begin(serverUrl);
        http.addHeader("Content-Type", "application/json");

        StaticJsonDocument<1024> doc;
        doc["record_id"] = recordId++;
        doc["mac_address"] = trackedMac;
        doc["bridge_uptime_ms"] = millis();

        JsonObject a1 = doc.createNestedObject("anchor_1");
        a1["seen"] = anchor1.seen;
        a1["avg_rssi"] = anchor1.avg_rssi;
        a1["min_rssi"] = anchor1.min_rssi;
        a1["max_rssi"] = anchor1.max_rssi;
        a1["samples"] = anchor1.samples;
        a1["seq_no"] = anchor1.seq_no;
        a1["sniffer_uptime_ms"] = anchor1.uptime_ms;
        a1["window_id"] = anchor1.window_id;

        JsonObject a2 = doc.createNestedObject("anchor_2");
        a2["seen"] = anchor2.seen;
        a2["avg_rssi"] = anchor2.avg_rssi;
        a2["min_rssi"] = anchor2.min_rssi;
        a2["max_rssi"] = anchor2.max_rssi;
        a2["samples"] = anchor2.samples;
        a2["seq_no"] = anchor2.seq_no;
        a2["sniffer_uptime_ms"] = anchor2.uptime_ms;
        a2["window_id"] = anchor2.window_id;

        JsonObject a3 = doc.createNestedObject("anchor_3");
        a3["seen"] = anchor3.seen;
        a3["avg_rssi"] = anchor3.avg_rssi;
        a3["min_rssi"] = anchor3.min_rssi;
        a3["max_rssi"] = anchor3.max_rssi;
        a3["samples"] = anchor3.samples;
        a3["seq_no"] = anchor3.seq_no;
        a3["sniffer_uptime_ms"] = anchor3.uptime_ms;
        a3["window_id"] = anchor3.window_id;

        String requestBody;
        serializeJson(doc, requestBody);

        Serial.println("---- HTTP POST BODY ----");
        Serial.println(requestBody);
        Serial.println("------------------------");

        int httpResponseCode = http.POST(requestBody);

        if (httpResponseCode > 0) {
          Serial.print("HTTP Response Code: ");
          Serial.println(httpResponseCode);
          Serial.println(http.getString());
        } else {
          Serial.print("HTTP Error: ");
          Serial.println(httpResponseCode);
        }

        http.end();

        resetAnchorWindow(anchor1);
        resetAnchorWindow(anchor2);
        resetAnchorWindow(anchor3);
      } else {
        Serial.println("No anchor data received in this window.");
      }
    } else {
      Serial.println("WiFi lost. Reconnecting...");
      WiFi.disconnect();
      WiFi.begin(ssid, password);
    }

    lastHttpSendTime = millis();
  }
}
