#include <WiFi.h>
#include <WiFiUdp.h>
#include <esp_wifi.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// Configuration Variables 
const char* ssid = "Umniah_71465A";         // changed
const char* password = "7B71465D"; // changed
const char* laptop_ip = "192.168.1.112";         //changed
const int udp_port = 12345;
WiFiUDP udp;

uint8_t target_mac[6] = {0x28, 0xC2, 0x1F, 0xEC, 0x23, 0x1A}; // changed
int sniffer_id = 1; // Change this for each ESP32 device (1, 2, 3, 4)

#define MAX_CSI_LEN 384 
struct CsiPacket {
    int8_t   buf[MAX_CSI_LEN];
    int      len;
    int8_t   rssi;
    uint64_t timestamp_us;
};
QueueHandle_t csi_queue;
char payload_buffer[2048]; 

void _wifi_csi_cb(void *ctx, wifi_csi_info_t *data) {
    if (memcmp(data->mac, target_mac, 6) != 0) return;

    CsiPacket pkt;
    pkt.timestamp_us = esp_timer_get_time(); 
    pkt.rssi = data->rx_ctrl.rssi;
    pkt.len  = (data->len < MAX_CSI_LEN) ? data->len : MAX_CSI_LEN;
    memcpy(pkt.buf, data->buf, pkt.len);

    xQueueSendFromISR(csi_queue, &pkt, NULL);
}

void csi_sender_task(void *pvParameters) {
    CsiPacket pkt;
    while (true) {
        if (xQueueReceive(csi_queue, &pkt, portMAX_DELAY)) {
            
            Serial.printf("CSI Success! Sniffer: %d | RSSI: %d | Len: %d\n", sniffer_id, pkt.rssi, pkt.len);

            int offset = snprintf(payload_buffer, sizeof(payload_buffer), 
                                  "DATA,%d,%llu,%d,", 
                                  sniffer_id, pkt.timestamp_us, pkt.rssi);
            for (int i = 0; i < pkt.len; i++) {
                offset += snprintf(payload_buffer + offset, 
                                   sizeof(payload_buffer) - offset, 
                                   "%d ", pkt.buf[i]);
            }
            
            udp.beginPacket(laptop_ip, udp_port);
            udp.printf("%s", payload_buffer);
            udp.endPacket();
        }
    }
}

void setup() {
    Serial.begin(115200);
    
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) { delay(500); }
    
    csi_queue = xQueueCreate(30, sizeof(CsiPacket));
    xTaskCreatePinnedToCore(csi_sender_task, "csi_sender", 4096, NULL, 5, NULL, 0);

    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(7, WIFI_SECOND_CHAN_NONE);     
    wifi_csi_config_t csi_config = {
        .lltf_en           = true,
        .htltf_en          = true,
        .stbc_htltf2_en    = true,
        .ltf_merge_en      = true,
        .channel_filter_en = false,
        .manu_scale        = false,
        .shift             = false,
    };
    esp_wifi_set_csi_config(&csi_config);
    esp_wifi_set_csi_rx_cb(&_wifi_csi_cb, NULL);
    esp_wifi_set_csi(true);
}

void loop() {
    delay(10000);
}
