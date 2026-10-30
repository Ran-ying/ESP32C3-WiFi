#include "web.h"
#include "lab_wifi.h"
#include "esp_http_server.h"
#include <string.h>
#include <stdlib.h>
static httpd_handle_t server;
extern const uint8_t html_start[] asm("_binary_index_html_start"), html_end[] asm("_binary_index_html_end");
extern const uint8_t js_start[] asm("_binary_app_js_start"), js_end[] asm("_binary_app_js_end");
extern const uint8_t css_start[] asm("_binary_style_css_start"), css_end[] asm("_binary_style_css_end");
static esp_err_t json(httpd_req_t *r,cJSON *o) {
    char *s=cJSON_PrintUnformatted(o); cJSON_Delete(o);
    if(!s)return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"JSON allocation failed");
    httpd_resp_set_type(r,"application/json");httpd_resp_set_hdr(r,"Cache-Control","no-store");
    esp_err_t e=httpd_resp_sendstr(r,s);free(s);return e;
}
static esp_err_t status(httpd_req_t *r){return json(r,lab_wifi_status());}
static esp_err_t networks(httpd_req_t *r){return json(r,lab_wifi_networks());}
static esp_err_t result(httpd_req_t *r,esp_err_t e) {
    httpd_resp_set_status(r,e==ESP_OK?"202 Accepted":"409 Conflict");
    cJSON *o=cJSON_CreateObject();cJSON_AddBoolToObject(o,"accepted",e==ESP_OK);
    cJSON_AddStringToObject(o,"message",e==ESP_OK?"操作已接受；切换信道后重新加入设备热点，打开 192.168.4.1":esp_err_to_name(e));return json(r,o);
}
static bool mutation_allowed(httpd_req_t *r) {
    /* Browser writes must originate from our exact local origin. */
    char origin[80],host[80];
    if(httpd_req_get_hdr_value_str(r,"Host",host,sizeof(host))!=ESP_OK || strcmp(host,"192.168.4.1"))return false;
    if(httpd_req_get_hdr_value_str(r,"Origin",origin,sizeof(origin))==ESP_OK && strcmp(origin,"http://192.168.4.1"))return false;
    char marker[8];return httpd_req_get_hdr_value_str(r,"X-Lab",marker,sizeof(marker))==ESP_OK && !strcmp(marker,"1");
}
static esp_err_t scan(httpd_req_t *r){if(!mutation_allowed(r))return httpd_resp_send_err(r,HTTPD_403_FORBIDDEN,"Local origin required");return result(r,lab_wifi_scan());}
static esp_err_t select_target(httpd_req_t *r){
    if(!mutation_allowed(r))return httpd_resp_send_err(r,HTTPD_403_FORBIDDEN,"Local origin required");
    if(r->content_len<=0||r->content_len>256)return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Invalid body length");
    char body[257];int total=0;
    while(total<r->content_len){int n=httpd_req_recv(r,body+total,r->content_len-total);if(n<=0)return ESP_FAIL;total+=n;}body[total]=0;
    cJSON *o=cJSON_Parse(body);cJSON *b=cJSON_GetObjectItemCaseSensitive(o,"bssid"),*a=cJSON_GetObjectItemCaseSensitive(o,"authorized");
    esp_err_t e=cJSON_IsString(b)?lab_wifi_select(b->valuestring,cJSON_IsTrue(a)):ESP_ERR_INVALID_ARG;
    cJSON_Delete(o);return result(r,e);
}
static esp_err_t asset(httpd_req_t *r) {
    httpd_resp_set_hdr(r,"Cache-Control","no-cache");
    httpd_resp_set_hdr(r,"X-Content-Type-Options","nosniff");
    httpd_resp_set_hdr(r,"Content-Security-Policy","default-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if(!strcmp(r->uri,"/app.js")){httpd_resp_set_type(r,"application/javascript");return httpd_resp_send(r,(const char*)js_start,js_end-js_start);}
    if(!strcmp(r->uri,"/style.css")){httpd_resp_set_type(r,"text/css");return httpd_resp_send(r,(const char*)css_start,css_end-css_start);}
    httpd_resp_set_type(r,"text/html; charset=utf-8");return httpd_resp_send(r,(const char*)html_start,html_end-html_start);
}
static void route(const char *uri,httpd_method_t method,esp_err_t (*fn)(httpd_req_t *)){
    httpd_uri_t u={.uri=uri,.method=method,.handler=fn};ESP_ERROR_CHECK(httpd_register_uri_handler(server,&u));
}
void web_stop(void){if(server){ESP_ERROR_CHECK(httpd_stop(server));server=NULL;}}
void web_start(void){
    if(server)return;
    httpd_config_t c=HTTPD_DEFAULT_CONFIG();c.stack_size=8192;c.max_uri_handlers=16;c.lru_purge_enable=true;
    ESP_ERROR_CHECK(httpd_start(&server,&c));
    route("/",HTTP_GET,asset);route("/app.js",HTTP_GET,asset);route("/style.css",HTTP_GET,asset);
    route("/api/status",HTTP_GET,status);route("/api/networks",HTTP_GET,networks);
    route("/api/scan",HTTP_POST,scan);route("/api/target",HTTP_POST,select_target);
    lab_wifi_hooks(web_stop,web_start);
}
