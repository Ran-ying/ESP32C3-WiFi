#include "sniffer.h"
#include "esp_timer.h"
#include "esp_check.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
static portMUX_TYPE mux=portMUX_INITIALIZER_UNLOCKED;
static SemaphoreHandle_t lock;
static QueueHandle_t queue;
static lab_target_t selected;
static bool enabled;
static uint32_t generation,data_frames,queue_drops,oversize,wrong_channel,rejected;
static uint32_t accepted,overwritten,record_count,record_next;
static uint64_t last_us;
static hs_store_t store;
static hs_record_t records[HS_RECORDS];
typedef struct {uint32_t generation;hs_record_t record;} item_t;
static void callback(void *buf,wifi_promiscuous_pkt_type_t type){
    if(type!=WIFI_PKT_DATA)return;
    wifi_promiscuous_pkt_t *p=buf;
    lab_target_t t;bool active;uint32_t gen;
    portENTER_CRITICAL(&mux);t=selected;active=enabled;gen=generation;portEXIT_CRITICAL(&mux);
    if(!active || p->rx_ctrl.rx_state || p->rx_ctrl.sig_len<28)return;
    size_t n=p->rx_ctrl.sig_len-4; /* SDK sig_len includes 4-byte FCS */
    if(!hs_frame_target(p->payload,n,t.bssid))return;
    portENTER_CRITICAL(&mux);
    if(p->rx_ctrl.channel!=t.channel){wrong_channel++;portEXIT_CRITICAL(&mux);return;}
    data_frames++;portEXIT_CRITICAL(&mux);
    if(!hs_eapol_candidate(p->payload,n,t.bssid))return;
    if(n>HS_FRAME_MAX){portENTER_CRITICAL(&mux);oversize++;portEXIT_CRITICAL(&mux);return;}
    item_t item={.generation=gen};item.record.length=n;item.record.time_us=esp_timer_get_time();item.record.channel=p->rx_ctrl.channel;
    memcpy(item.record.bssid,t.bssid,6);memcpy(item.record.data,p->payload,n);
    if(xQueueSend(queue,&item,0)!=pdTRUE){portENTER_CRITICAL(&mux);queue_drops++;portEXIT_CRITICAL(&mux);}
}
static void worker(void *arg){
    (void)arg;item_t item;hs_key_t key;
    while(xQueueReceive(queue,&item,portMAX_DELAY)){
        xSemaphoreTake(lock,portMAX_DELAY);
        portENTER_CRITICAL(&mux);uint32_t gen=generation;bool active=enabled;portEXIT_CRITICAL(&mux);
        if(active&&gen==item.generation){
            if(hs_parse(item.record.data,item.record.length,item.record.bssid,&key)){
                hs_accept(&store,&key,item.record.time_us);accepted++;last_us=item.record.time_us;
                if(record_count==HS_RECORDS)overwritten++;else record_count++;
                records[record_next]=item.record;record_next=(record_next+1)%HS_RECORDS;
            }else rejected++;
        }
        xSemaphoreGive(lock);
    }
}
void sniffer_init(void){
    lock=xSemaphoreCreateMutex();queue=xQueueCreate(12,sizeof(item_t));assert(lock&&queue);
    wifi_promiscuous_filter_t filter={.filter_mask=WIFI_PROMIS_FILTER_MASK_DATA};
    ESP_ERROR_CHECK(esp_wifi_set_promiscuous_filter(&filter));ESP_ERROR_CHECK(esp_wifi_set_promiscuous_rx_cb(callback));
    assert(xTaskCreate(worker,"eapol_parser",6144,NULL,3,NULL)==pdPASS);
    lab_wifi_capture_hooks(sniffer_stop,sniffer_start);
}
void sniffer_stop(void){portENTER_CRITICAL(&mux);enabled=false;portEXIT_CRITICAL(&mux);ESP_ERROR_CHECK(esp_wifi_set_promiscuous(false));}
void sniffer_start(const lab_target_t *t){
    xSemaphoreTake(lock,portMAX_DELAY);
    bool same=selected.valid && !memcmp(selected.bssid,t->bssid,6) && selected.channel==t->channel &&
              selected.ssid_len==t->ssid_len && !memcmp(selected.ssid,t->ssid,t->ssid_len) &&
              selected.auth==t->auth && selected.pairwise==t->pairwise;
    if(!same){memset(&store,0,sizeof(store));record_count=record_next=accepted=overwritten=rejected=0;last_us=0;}
    portENTER_CRITICAL(&mux);selected=*t;generation++;if(!same)data_frames=queue_drops=oversize=wrong_channel=0;enabled=true;portEXIT_CRITICAL(&mux);
    xSemaphoreGive(lock);ESP_ERROR_CHECK(esp_wifi_set_promiscuous(true));
}
static void hex(cJSON *o,const char *name,const uint8_t *p,size_t n){
    char *s=malloc(n*2+1);if(!s)return;static const char h[]="0123456789abcdef";
    for(size_t i=0;i<n;i++){s[2*i]=h[p[i]>>4];s[2*i+1]=h[p[i]&15];}s[n*2]=0;cJSON_AddStringToObject(o,name,s);free(s);
}
static void mac(cJSON *o,const char *name,const uint8_t *p){char s[18];snprintf(s,sizeof(s),"%02x:%02x:%02x:%02x:%02x:%02x",p[0],p[1],p[2],p[3],p[4],p[5]);cJSON_AddStringToObject(o,name,s);}
cJSON *sniffer_status(void){
    cJSON *o=cJSON_CreateObject();xSemaphoreTake(lock,portMAX_DELAY);
    portENTER_CRITICAL(&mux);lab_target_t t=selected;bool active=enabled;uint32_t frames=data_frames,drops=queue_drops,large=oversize,wrong=wrong_channel,gen=generation;portEXIT_CRITICAL(&mux);
    bool supported=t.valid&&t.auth==WIFI_AUTH_WPA2_PSK&&t.pairwise==WIFI_CIPHER_TYPE_CCMP;
    cJSON_AddBoolToObject(o,"listening",active);cJSON_AddNumberToObject(o,"generation",gen);
    cJSON_AddStringToObject(o,"security",supported?"WPA2-PSK / CCMP":"UNSUPPORTED / NOT TESTED");
    cJSON_AddNumberToObject(o,"data_frames",frames);cJSON_AddNumberToObject(o,"queue_drops",drops);
    cJSON_AddNumberToObject(o,"oversize",large);cJSON_AddNumberToObject(o,"wrong_channel",wrong);
    cJSON_AddNumberToObject(o,"rejected_eapol",rejected);cJSON_AddNumberToObject(o,"captured",accepted);
    cJSON_AddNumberToObject(o,"record_overwrites",overwritten);cJSON_AddNumberToObject(o,"session_evictions",store.evicted);
    cJSON_AddNumberToObject(o,"last_rx_us",last_us);cJSON_AddNumberToObject(o,"channel",t.channel);
    mac(o,"bssid",t.bssid);hex(o,"ssid_hex",t.ssid,t.ssid_len);
    cJSON *a=cJSON_AddArrayToObject(o,"sessions");
    for(int i=0;i<HS_SESSIONS;i++){
        const hs_session_t *s=&store.sessions[i];if(!s->used)continue;
        cJSON *v=cJSON_CreateObject();cJSON_AddItemToArray(a,v);
        bool valid=supported&&t.ssid_len>0&&hs_verifiable(s);
        cJSON_AddNumberToObject(v,"id",s->id);mac(v,"ap",s->ap);mac(v,"client",s->client);
        cJSON_AddNumberToObject(v,"mask",s->mask);cJSON_AddNumberToObject(v,"frames",s->frames);
        cJSON_AddNumberToObject(v,"last_us",s->last_us);cJSON_AddNumberToObject(v,"version",s->version);
        cJSON_AddBoolToObject(v,"verifiable",valid);
        cJSON_AddStringToObject(v,"state",!supported||!s->supported?"UNSUPPORTED":valid&&hs_complete(s)?"COMPLETE":valid?"VERIFIABLE":"CAPTURED");
        const char *missing=s->ambiguous?"会话存在冲突，无法可靠关联":!supported||!s->supported?"仅支持 WPA2-PSK + CCMP，描述符版本 2":!t.ssid_len?"缺少非隐藏 SSID":!s->have_anonce?"缺少 ANonce (M1/M3)":!s->have_snonce?"缺少 SNonce (M2)":!(s->mask&2)?"缺少 M2 验证数据":!valid?"MIC 缺失":"";
        cJSON_AddStringToObject(v,"missing",missing);
        if(s->have_anonce)hex(v,"anonce",s->anonce,32);
        if(s->have_snonce)hex(v,"snonce",s->snonce,32);
        cJSON *msgs=cJSON_AddArrayToObject(v,"messages");
        for(int j=0;j<4;j++)if(s->mask&(1<<j)){
            const hs_key_t *k=&s->messages[j];cJSON *m=cJSON_CreateObject();cJSON_AddItemToArray(msgs,m);
            cJSON_AddNumberToObject(m,"message",j+1);cJSON_AddNumberToObject(m,"key_info",k->key_info);
            char replay[24];snprintf(replay,sizeof(replay),"%llu",(unsigned long long)k->replay);cJSON_AddStringToObject(m,"replay",replay);
            hex(m,"mic",k->mic,16);hex(m,"nonce",k->nonce,32);
        }
        if(s->mask&2){const hs_key_t *k=&s->messages[1];hex(v,"mic",k->mic,16);hex(v,"eapol",k->eapol,k->eapol_len);}
    }
    cJSON *bindings=cJSON_AddArrayToObject(o,"records");
    for(uint32_t i=0;i<record_count;i++){
        const hs_record_t *r=&records[(record_next+HS_RECORDS-record_count+i)%HS_RECORDS];cJSON *v=cJSON_CreateObject();cJSON_AddItemToArray(bindings,v);
        cJSON_AddNumberToObject(v,"index",i);cJSON_AddNumberToObject(v,"time_us",r->time_us);cJSON_AddNumberToObject(v,"channel",r->channel);mac(v,"bssid",r->bssid);cJSON_AddNumberToObject(v,"length",r->length);
    }
    xSemaphoreGive(lock);return o;
}
uint8_t *sniffer_pcap(size_t *length){
    *length=0;xSemaphoreTake(lock,portMAX_DELAY);
    size_t cap=24+record_count*(28+HS_FRAME_MAX);uint8_t *out=malloc(cap);
    if(out){size_t at=hs_pcap_header(out);for(uint32_t i=0;i<record_count;i++){
        const hs_record_t *r=&records[(record_next+HS_RECORDS-record_count+i)%HS_RECORDS];size_t n=hs_pcap_record(r,out+at,cap-at);
        if(!n){free(out);out=NULL;break;}at+=n;
    }if(out)*length=at;}
    xSemaphoreGive(lock);return out;
}
