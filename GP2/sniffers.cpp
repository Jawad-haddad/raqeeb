#include <WiFi.h>
#include <WiFiUdp.h>
#include <esp_wifi.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <lwip/sockets.h>

const char* ssid      = "Umniah_71465A";
const char* password  = "7B71465D";
const char* laptop_ip = "192.168.1.112";
const int   udp_port  = 12345;

uint8_t target_mac[6] = {0x28, 0xC2, 0x1F, 0xEC, 0x23, 0x1A};

int sniffer_id = 1;

#define MAX_CSI_LEN 384
struct CsiPacket {
    int8_t   buf[MAX_CSI_LEN];
    int      len;
    int8_t   rssi;
    uint64_t timestamp_us;
};
QueueHandle_t csi_queue;
char payload_buffer[2048];

int udp_socket = -1;
struct sockaddr_in dest_addr;

volatile uint32_t csi_count = 0;
volatile uint32_t udp_count = 0;
volatile uint32_t udp_fail  = 0;
unsigned long last_status_time = 0;

void _wifi_csi_cb(void *ctx, wifi_csi_info_t *data) {
    if (memcmp(data->mac, target_mac, 6) != 0) return;

    CsiPacket pkt;
    pkt.timestamp_us = esp_timer_get_time();
    pkt.rssi = data->rx_ctrl.rssi;
    pkt.len  = (data->len < MAX_CSI_LEN) ? data->len : MAX_CSI_LEN;
    memcpy(pkt.buf, data->buf, pkt.len);

    csi_count++;
    BaseType_t higher_priority_woken = pdFALSE;
    xQueueSendFromISR(csi_queue, &pkt, &higher_priority_woken);
}

void csi_sender_task(void *pvParameters) {
    CsiPacket pkt;
    while (true) {
        if (xQueueReceive(csi_queue, &pkt, portMAX_DELAY)) {

            int offset = snprintf(payload_buffer, sizeof(payload_buffer),
                                  "DATA,%d,%llu,%d,",
                                  sniffer_id, pkt.timestamp_us, pkt.rssi);

            for (int i = 0; i < pkt.len; i++) {
                offset += snprintf(payload_buffer + offset,
                                   sizeof(payload_buffer) - offset,
                                   "%d ", pkt.buf[i]);
            }

            if (udp_socket >= 0) {
                int sent = sendto(udp_socket, payload_buffer, offset, 0,
                                  (struct sockaddr*)&dest_addr, sizeof(dest_addr));
                if (sent > 0) {
                    udp_count++;
                } else {
                    udp_fail++;
                }
            }
        }
    }
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println();
    Serial.println("=========================================");
    Serial.printf("Sniffer ID: %d   |   Booting...\n", sniffer_id);
    Serial.println("=========================================");

    Serial.printf("Connecting to WiFi: %s\n", ssid);
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);

    int wait = 0;
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
        wait++;
        if (wait > 60) {
            Serial.println("\nWiFi failed — restarting...");
            ESP.restart();
        }
    }

    Serial.println();
    Serial.printf("WiFi connected!\n");
    Serial.printf("  IP address  : %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("  Sending to  : %s:%d\n", laptop_ip, udp_port);

    udp_socket = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (udp_socket < 0) {
        Serial.println("FATAL: Failed to create socket!");
        ESP.restart();
    }

    dest_addr.sin_family      = AF_INET;
    dest_addr.sin_port        = htons(udp_port);
    dest_addr.sin_addr.s_addr = inet_addr(laptop_ip);

    Serial.println("UDP socket ready.");

    const char* test_msg = "BOOT_TEST_PACKET";
    int sent = sendto(udp_socket, test_msg, strlen(test_msg), 0,
                      (struct sockaddr*)&dest_addr, sizeof(dest_addr));
    Serial.printf("Test packet sent: %d bytes (should be > 0)\n", sent);

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

    Serial.println("CSI capture started.");
    Serial.println();
    last_status_time = millis();
}

void loop() {
    if (millis() - last_status_time > 5000) {
        Serial.printf("[heartbeat] CSI: %lu | UDP sent: %lu | UDP fail: %lu | WiFi: %s\n",
                      csi_count, udp_count, udp_fail,
                      WiFi.status() == WL_CONNECTED ? "OK" : "LOST");
        last_status_time = millis();

        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("WiFi lost — reconnecting...");
            WiFi.reconnect();
        }
    }
    delay(100);
}
