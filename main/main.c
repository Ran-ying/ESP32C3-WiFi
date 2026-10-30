#include "nvs_flash.h"
#include "esp_check.h"
#include "lab_wifi.h"
#include "web.h"
#include "sniffer.h"
void app_main(void) {
    esp_err_t e = nvs_flash_init();
    /* Do not erase credentials silently on a damaged/incompatible partition. */
    ESP_ERROR_CHECK(e);
    lab_wifi_init();
    sniffer_init();
    web_start();
}
