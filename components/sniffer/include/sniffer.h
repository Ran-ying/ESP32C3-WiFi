#pragma once
#include "lab_wifi.h"
#include "handshake.h"
void sniffer_init(void);
void sniffer_stop(void);
void sniffer_start(const lab_target_t *target);
cJSON *sniffer_status(void);
/* Snapshot a validated PCAP. Caller frees memory. */
uint8_t *sniffer_pcap(size_t *length);
