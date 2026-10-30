#include "lab_wifi.h"
#include "sdkconfig.h"
#include "esp_check.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "nvs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "freertos/queue.h"
#include <stdio.h>
#include <string.h>
#define MAX_AP 40
static SemaphoreHandle_t lock;
static QueueHandle_t jobs;
static wifi_ap_record_t aps[MAX_AP];
static uint16_t count;
static wifi_country_t country;
static lab_target_t target;
static bool busy;
static uint32_t boot_id;
static const char *phase = "IDLE";
static esp_err_t last_error;
static void (*pause_web)(void), (*resume_web)(void);
static void (*stop_capture)(void), (*start_capture)(const lab_target_t *);
static wifi_config_t ap;
typedef struct { bool scan; lab_target_t target; } job_t;
static void macstr(const uint8_t *m, char *out) {
    snprintf(out,18,"%02x:%02x:%02x:%02x:%02x:%02x",m[0],m[1],m[2],m[3],m[4],m[5]);
}
static void finish(const char *p, esp_err_t e) {
    xSemaphoreTake(lock,portMAX_DELAY); phase=p; last_error=e; busy=false; xSemaphoreGive(lock);
}
static void controller(void *arg) {
    (void)arg; job_t j;
    while (xQueueReceive(jobs,&j,portMAX_DELAY)) {
        if (stop_capture) stop_capture();
        esp_err_t e;
        if (j.scan) {
            wifi_scan_config_t c={.show_hidden=true,.scan_type=WIFI_SCAN_TYPE_PASSIVE,.scan_time.passive=120};
            e=esp_wifi_scan_start(&c,true);
            uint16_t n=MAX_AP;
            wifi_ap_record_t *results=calloc(MAX_AP,sizeof(*results));
            if (!results) { esp_wifi_clear_ap_list(); finish("ERROR",ESP_ERR_NO_MEM); continue; }
            if (e==ESP_OK) e=esp_wifi_scan_get_ap_records(&n,results);
            else esp_wifi_clear_ap_list();
            xSemaphoreTake(lock,portMAX_DELAY);
            count=e==ESP_OK?n:0; memcpy(aps,results,count*sizeof(*aps));
            xSemaphoreGive(lock); free(results);
            /* Capture stays paused until explicit target re-selection after a scan. */
            finish(e==ESP_OK?"SCAN_DONE":"ERROR",e);
            continue;
        }
        /* Allow the 202 response to reach Safari before disconnecting SoftAP. */
        vTaskDelay(pdMS_TO_TICKS(1200));
        if (pause_web) pause_web();
        e=esp_wifi_scan_stop();
        if (e==ESP_OK) e=esp_wifi_stop();
        if (e==ESP_OK) {
            ap.ap.channel=j.target.channel;
            e=esp_wifi_set_config(WIFI_IF_AP,&ap);
        }
        if (e==ESP_OK) e=esp_wifi_start();
        uint8_t ch=0; wifi_second_chan_t secondary;
        if (e==ESP_OK) e=esp_wifi_get_channel(&ch,&secondary);
        if (e==ESP_OK && ch!=j.target.channel) e=ESP_ERR_INVALID_STATE;
        if (e==ESP_OK) {
            nvs_handle_t h;
            e=nvs_open("lab",NVS_READWRITE,&h);
            if (e==ESP_OK) { e=nvs_set_blob(h,"target",&j.target,sizeof(j.target)); if(e==ESP_OK)e=nvs_commit(h); nvs_close(h); }
        }
        if (e==ESP_OK) {
            xSemaphoreTake(lock,portMAX_DELAY); target=j.target; xSemaphoreGive(lock);
            if (start_capture) start_capture(&j.target);
        }
        if (resume_web) resume_web();
        finish(e==ESP_OK?"READY":"ERROR",e);
    }
}
void lab_wifi_hooks(void (*p)(void),void (*r)(void)) { pause_web=p; resume_web=r; }
void lab_wifi_capture_hooks(void (*p)(void),void (*r)(const lab_target_t *)) { stop_capture=p; start_capture=r; }
void lab_wifi_init(void) {
    boot_id=esp_random();
    lock=xSemaphoreCreateMutex(); jobs=xQueueCreate(1,sizeof(job_t)); assert(lock&&jobs);
    ESP_ERROR_CHECK(esp_netif_init()); ESP_ERROR_CHECK(esp_event_loop_create_default());
    assert(esp_netif_create_default_wifi_ap()); assert(esp_netif_create_default_wifi_sta());
    wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT(); ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    /* Neutral driver code, explicit permitted range. No country lookup.
       IDF 5.4.2 hardware tests verified 01 + MANUAL + channels 1-13. */
    country=(wifi_country_t){.cc="01",.schan=1,.nchan=CONFIG_LAB_CHANNEL_MAX,
                             .max_tx_power=20,.policy=WIFI_COUNTRY_POLICY_MANUAL};
    ESP_ERROR_CHECK(esp_wifi_set_country(&country));
    ESP_ERROR_CHECK(esp_wifi_get_country(&country));
    assert(country.schan==1 && country.nchan==CONFIG_LAB_CHANNEL_MAX);
    ESP_LOGI("lab","Configured channels=%u-%u",country.schan,country.schan+country.nchan-1);
    const char *ssid=CONFIG_LAB_AP_SSID;
    assert(strlen(ssid)>0 && strlen(ssid)<=32);
    memcpy(ap.ap.ssid,ssid,strlen(ssid)); ap.ap.ssid_len=strlen(ssid);
    ap.ap.channel=1; ap.ap.max_connection=3; ap.ap.authmode=WIFI_AUTH_WPA2_PSK;
    ap.ap.pairwise_cipher=WIFI_CIPHER_TYPE_CCMP;
    char password[64]={0};
    if (strlen(CONFIG_LAB_AP_PASSWORD)) snprintf(password,sizeof(password),"%s",CONFIG_LAB_AP_PASSWORD);
    else {
        nvs_handle_t h; ESP_ERROR_CHECK(nvs_open("lab",NVS_READWRITE,&h));
        size_t size=sizeof(password); esp_err_t e=nvs_get_str(h,"ap_password",password,&size);
        if(e==ESP_ERR_NVS_NOT_FOUND) {
            uint32_t random[2]; esp_fill_random(random,sizeof(random));
            snprintf(password,sizeof(password),"%08lx%08lx",(unsigned long)random[0],(unsigned long)random[1]);
            ESP_ERROR_CHECK(nvs_set_str(h,"ap_password",password)); ESP_ERROR_CHECK(nvs_commit(h));
        } else ESP_ERROR_CHECK(e);
        nvs_close(h);
    }
    assert(strlen(password)>=8 && strlen(password)<=63);
    for(size_t i=0;i<strlen(password);i++) assert(password[i]>=32 && password[i]<=126);
    memcpy(ap.ap.password,password,strlen(password));
    ESP_LOGW("lab","Private SoftAP password (serial only): %s",password);
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP,&ap)); ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
    assert(xTaskCreate(controller,"wifi_control",6144,NULL,4,NULL)==pdPASS);
}
esp_err_t lab_wifi_scan(void) {
    xSemaphoreTake(lock,portMAX_DELAY);
    if(busy){xSemaphoreGive(lock);return ESP_ERR_INVALID_STATE;}
    busy=true; phase="SCANNING"; job_t j={.scan=true};
    BaseType_t ok=xQueueSend(jobs,&j,0); xSemaphoreGive(lock);
    return ok==pdTRUE?ESP_OK:ESP_FAIL;
}
esp_err_t lab_wifi_select(const char *bssid,bool authorized) {
    if(!authorized||!bssid) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(lock,portMAX_DELAY);
    if(busy){xSemaphoreGive(lock);return ESP_ERR_INVALID_STATE;}
    job_t j={0};
    for(int i=0;i<count;i++) {
        char m[18]; macstr(aps[i].bssid,m);
        if(strcmp(m,bssid)==0 && aps[i].primary>=country.schan && aps[i].primary<country.schan+country.nchan) {
            memcpy(j.target.bssid,aps[i].bssid,6); j.target.ssid_len=strnlen((char*)aps[i].ssid,32);
            memcpy(j.target.ssid,aps[i].ssid,j.target.ssid_len);
            j.target.channel=aps[i].primary; j.target.auth=aps[i].authmode;
            j.target.pairwise=aps[i].pairwise_cipher; j.target.valid=true; break;
        }
    }
    if(!j.target.valid){xSemaphoreGive(lock);return ESP_ERR_NOT_FOUND;}
    busy=true; phase="SWITCHING"; BaseType_t ok=xQueueSend(jobs,&j,0); xSemaphoreGive(lock);
    return ok==pdTRUE?ESP_OK:ESP_FAIL;
}
cJSON *lab_wifi_status(void) {
    uint8_t ch=0; wifi_second_chan_t s; esp_err_t e=esp_wifi_get_channel(&ch,&s);
    cJSON *o=cJSON_CreateObject(); xSemaphoreTake(lock,portMAX_DELAY);
    cJSON_AddNumberToObject(o,"max_channel",country.schan+country.nchan-1);
    cJSON_AddNumberToObject(o,"uptime_ms",esp_timer_get_time()/1000);
    cJSON_AddNumberToObject(o,"boot_id",boot_id);
    cJSON_AddStringToObject(o,"phase",phase); cJSON_AddBoolToObject(o,"busy",busy);
    cJSON_AddStringToObject(o,"error",esp_err_to_name(last_error));
    cJSON_AddStringToObject(o,"ssid",CONFIG_LAB_AP_SSID); cJSON_AddStringToObject(o,"ip","192.168.4.1");
    cJSON_AddNumberToObject(o,"channel",e==ESP_OK?ch:0);
    cJSON_AddBoolToObject(o,"target_valid",target.valid);
    if(target.valid) {
        char m[18],ssid[33]={0};macstr(target.bssid,m);memcpy(ssid,target.ssid,target.ssid_len);
        cJSON_AddStringToObject(o,"target_bssid",m);cJSON_AddStringToObject(o,"target_ssid",ssid);
        cJSON_AddNumberToObject(o,"target_channel",target.channel);
    }
    xSemaphoreGive(lock);return o;
}
cJSON *lab_wifi_networks(void) {
    cJSON *a=cJSON_CreateArray();xSemaphoreTake(lock,portMAX_DELAY);
    for(int i=0;i<count;i++) {
        cJSON *o=cJSON_CreateObject();char m[18],ssid[33]={0};macstr(aps[i].bssid,m);memcpy(ssid,aps[i].ssid,32);
        cJSON_AddStringToObject(o,"ssid",ssid);cJSON_AddStringToObject(o,"bssid",m);
        cJSON_AddNumberToObject(o,"channel",aps[i].primary);cJSON_AddNumberToObject(o,"rssi",aps[i].rssi);
        cJSON_AddNumberToObject(o,"auth_id",aps[i].authmode);
        const char *auth=aps[i].authmode==WIFI_AUTH_OPEN?"OPEN":aps[i].authmode==WIFI_AUTH_WPA2_PSK?"WPA2-Personal":aps[i].authmode==WIFI_AUTH_WPA_WPA2_PSK?"WPA/WPA2-Personal":aps[i].authmode==WIFI_AUTH_WPA3_PSK?"WPA3-Personal":"OTHER / UNSUPPORTED";
        cJSON_AddStringToObject(o,"auth",auth);cJSON_AddItemToArray(a,o);
    }
    xSemaphoreGive(lock);return a;
}
