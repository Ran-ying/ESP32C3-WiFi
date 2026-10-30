#pragma once
#include "esp_err.h"
#include "esp_wifi.h"
#include "cJSON.h"
#include <stdbool.h>
typedef struct {
    uint8_t bssid[6], ssid[32], ssid_len, channel;
    wifi_auth_mode_t auth;
    wifi_cipher_type_t pairwise;
    bool valid;
} lab_target_t;
void lab_wifi_init(void);
cJSON *lab_wifi_status(void);
cJSON *lab_wifi_networks(void);
esp_err_t lab_wifi_scan(void);
esp_err_t lab_wifi_select(const char *bssid, bool authorized);
void lab_wifi_hooks(void (*pause)(void), void (*resume)(void));
/* Hooks execute in the controller task, never in the Wi-Fi callback. */
void lab_wifi_capture_hooks(void (*stop)(void), void (*start)(const lab_target_t *));
