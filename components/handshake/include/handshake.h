#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#define HS_EAPOL_MAX 512
#define HS_SESSIONS 8
#define HS_FRAME_MAX 768
#define HS_RECORDS 24
typedef struct {
    uint8_t ap[6],client[6],nonce[32],mic[16],message,version;
    uint16_t key_info,key_length,eapol_len;
    uint64_t replay;
    uint8_t eapol[HS_EAPOL_MAX];
} hs_key_t;
typedef struct {
    bool used,ambiguous;
    uint32_t id,frames;
    uint64_t replay_base,last_us;
    uint8_t ap[6],client[6],anonce[32],snonce[32],mask,version;
    bool have_anonce,have_snonce,supported;
    hs_key_t messages[4];
} hs_session_t;
typedef struct { hs_session_t sessions[HS_SESSIONS];uint32_t next_id,evicted; } hs_store_t;
typedef struct {uint64_t time_us;uint16_t length;uint8_t channel,bssid[6];uint8_t data[HS_FRAME_MAX];} hs_record_t;
/* Input is an 802.11 MPDU without FCS. No allocation, no SDK dependencies. */
bool hs_frame_target(const uint8_t *f,size_t n,const uint8_t bssid[6]);
bool hs_eapol_candidate(const uint8_t *f,size_t n,const uint8_t bssid[6]);
bool hs_parse(const uint8_t *f,size_t n,const uint8_t bssid[6],hs_key_t *out);
hs_session_t *hs_accept(hs_store_t *store,const hs_key_t *key,uint64_t time_us);
bool hs_verifiable(const hs_session_t *s);
bool hs_complete(const hs_session_t *s);
/* PCAP radiotap, little endian; actual RX channel in each record. */
size_t hs_pcap_header(uint8_t out[24]);
size_t hs_pcap_record(const hs_record_t *r,uint8_t *out,size_t capacity);
