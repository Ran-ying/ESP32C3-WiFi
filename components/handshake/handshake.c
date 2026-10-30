#include "handshake.h"
#include <string.h>
static uint16_t be16(const uint8_t *p){return (uint16_t)p[0]<<8|p[1];}
static bool nonzero(const uint8_t *p,size_t n){uint8_t v=0;for(size_t i=0;i<n;i++)v|=p[i];return v!=0;}
static size_t header(const uint8_t *f,size_t n,const uint8_t **ap,const uint8_t **src,const uint8_t **dst){
    if(n<24 || (f[0]&0x0f)!=8)return 0; /* data, unprotected */
    unsigned ds=f[1]&3;
    if(ds==3 || (f[1]&4) || (f[22]&15))return 0; /* WDS/fragmentation not supported */
    *ap=ds==1?f+4:ds==2?f+10:f+16;
    *src=ds==2?f+16:f+10;*dst=ds==1?f+16:f+4;
    size_t h=24;
    if(f[0]&0x80){
        if(n<h+2 || (f[h]&0x80))return 0; /* A-MSDU needs a subframe parser */
        h+=2;if(f[1]&0x80)h+=4; /* HT Control with QoS + Order */
    }
    return n>=h?h:0;
}
bool hs_frame_target(const uint8_t *f,size_t n,const uint8_t bssid[6]){
    const uint8_t *a,*s,*d;return header(f,n,&a,&s,&d)&&!memcmp(a,bssid,6);
}
bool hs_eapol_candidate(const uint8_t *f,size_t n,const uint8_t bssid[6]){
    const uint8_t *a,*s,*d;size_t h=header(f,n,&a,&s,&d);
    static const uint8_t llc[]={0xaa,0xaa,3,0,0,0,0x88,0x8e};
    return h && !(f[1]&0x40) && !memcmp(a,bssid,6) && n>=h+8+4 && !memcmp(f+h,llc,8);
}
bool hs_parse(const uint8_t *f,size_t n,const uint8_t bssid[6],hs_key_t *o){
    const uint8_t *a,*s,*d;size_t h=header(f,n,&a,&s,&d);
    static const uint8_t llc[]={0xaa,0xaa,3,0,0,0,0x88,0x8e};
    if(!h || (f[1]&0x40) || memcmp(a,bssid,6) || n<h+8+99 || memcmp(f+h,llc,8))return false;
    const uint8_t *p=f+h+8;size_t len=(size_t)be16(p+2)+4;
    if((p[0]!=1&&p[0]!=2) || p[1]!=3 || p[4]!=2 || len<99 || len>HS_EAPOL_MAX || len>n-h-8 || be16(p+97)!=len-99)return false;
    uint16_t info=be16(p+5);
    if(!(info&8) || (info&(0x400|0x800|0x2000)))return false; /* pairwise, no error/request/SMK */
    bool ack=info&0x80,mic=info&0x100,install=info&0x40,secure=info&0x200,encrypted=info&0x1000;
    unsigned ds=f[1]&3;
    if((ds==1&&memcmp(d,a,6))||(ds==2&&memcmp(s,a,6))||(ds==0&&memcmp(s,a,6)&&memcmp(d,a,6)))return false;
    bool from_ap=!memcmp(s,a,6);
    uint8_t message=0;
    if(from_ap && ack && !mic && !install && !secure && !encrypted && nonzero(p+17,32))message=1;
    if(!from_ap && !ack && mic && !install && !secure && !encrypted && nonzero(p+17,32))message=2;
    if(from_ap && ack && mic && install && nonzero(p+17,32))message=3;
    if(!from_ap && !ack && mic && !install && secure && !encrypted && !nonzero(p+17,32) && be16(p+97)==0)message=4;
    if(!message)return false;
    const uint8_t *client=from_ap?d:s;
    if((client[0]&1)||!memcmp(client,a,6)||!nonzero(client,6))return false;
    memset(o,0,sizeof(*o));memcpy(o->ap,a,6);memcpy(o->client,client,6);
    o->message=message;o->version=info&7;o->key_info=info;o->key_length=be16(p+7);
    for(int i=0;i<8;i++)o->replay=(o->replay<<8)|p[9+i];
    memcpy(o->nonce,p+17,32);memcpy(o->mic,p+81,16);o->eapol_len=len;memcpy(o->eapol,p,len);
    return true;
}
hs_session_t *hs_accept(hs_store_t *st,const hs_key_t *k,uint64_t us){
    if(k->message<1||k->message>4||k->eapol_len<99||k->eapol_len>HS_EAPOL_MAX)return NULL;
    bool late=k->message>=3;if(late&&k->replay==0)return NULL;
    uint64_t base=k->replay-(late?1:0);
    hs_session_t *s=NULL,*slot=NULL;bool ambiguous=false;
    for(int i=0;i<HS_SESSIONS;i++){
        hs_session_t *x=&st->sessions[i];
        if(!x->used){if(!slot)slot=x;continue;}
        if(x->replay_base==base&&!memcmp(x->ap,k->ap,6)&&!memcmp(x->client,k->client,6)){
            bool conflict=(x->version!=k->version);
            if(k->message==1||k->message==3)conflict|=x->have_anonce&&memcmp(x->anonce,k->nonce,32);
            if(k->message==2)conflict|=x->have_snonce&&memcmp(x->snonce,k->nonce,32);
            if(x->mask&(1<<(k->message-1))){const hs_key_t *old=&x->messages[k->message-1];conflict|=old->eapol_len!=k->eapol_len||memcmp(old->eapol,k->eapol,k->eapol_len);}
            if(conflict){x->ambiguous=true;ambiguous=true;}else{s=x;}
        }
    }
    if(!s){
        if(!slot){slot=&st->sessions[0];for(int i=1;i<HS_SESSIONS;i++)if(st->sessions[i].last_us<slot->last_us)slot=&st->sessions[i];st->evicted++;}
        s=slot;memset(s,0,sizeof(*s));s->used=true;s->id=++st->next_id;s->replay_base=base;s->version=k->version;s->supported=true;
        memcpy(s->ap,k->ap,6);memcpy(s->client,k->client,6);
    }
    s->ambiguous|=ambiguous;s->frames++;s->last_us=us;s->mask|=1<<(k->message-1);s->messages[k->message-1]=*k;
    if(k->message==1||k->message==3){s->have_anonce=true;memcpy(s->anonce,k->nonce,32);}
    if(k->message==2){s->have_snonce=true;memcpy(s->snonce,k->nonce,32);}
    /* RSN descriptor version 2; CCMP checked independently against selected AP. */
    s->supported&=k->version==2 && (k->key_length==16 || ((k->message==2||k->message==4)&&k->key_length==0));
    return s;
}
bool hs_verifiable(const hs_session_t *s){return s->used&&!s->ambiguous&&s->supported&&s->have_anonce&&s->have_snonce&&(s->mask&2)&&nonzero(s->messages[1].mic,16);}
bool hs_complete(const hs_session_t *s){return hs_verifiable(s)&&s->mask==15;}
static void le32(uint8_t *p,uint32_t n){for(int i=0;i<4;i++)p[i]=(n>>(8*i))&255;}
size_t hs_pcap_header(uint8_t out[24]){
    memset(out,0,24);le32(out,0xa1b2c3d4);out[4]=2;out[6]=4;le32(out+16,HS_FRAME_MAX+12);le32(out+20,127);return 24;
}
size_t hs_pcap_record(const hs_record_t *r,uint8_t *out,size_t cap){
    if(r->length<24||r->length>HS_FRAME_MAX||cap<(size_t)r->length+28||r->channel<1||r->channel>13||!hs_frame_target(r->data,r->length,r->bssid))return 0;
    hs_key_t key;if(!hs_parse(r->data,r->length,r->bssid,&key))return 0;
    le32(out,r->time_us/1000000);le32(out+4,r->time_us%1000000);le32(out+8,r->length+12);le32(out+12,r->length+12);
    memset(out+16,0,12);out[18]=12;out[20]=8; /* radiotap: channel present */
    unsigned freq=2407+5*r->channel;out[24]=freq&255;out[25]=freq>>8;out[26]=0x80;
    memcpy(out+28,r->data,r->length);return r->length+28;
}
