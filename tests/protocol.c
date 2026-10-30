#include "handshake.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
static const uint8_t ap[6]={2,0,0,0,0,1},client[6]={2,0,0,0,0,2};
static void be16(uint8_t *p,unsigned v){p[0]=v>>8;p[1]=v;}
static size_t frame(uint8_t *f,int m,uint64_t replay,bool qos,bool ht){
 memset(f,0,HS_FRAME_MAX);bool from=m==1||m==3;
 f[0]=qos?0x88:8;f[1]=(from?2:1)|(ht?0x80:0);
 memcpy(f+4,from?client:ap,6);memcpy(f+10,from?ap:client,6);memcpy(f+16,from?ap:ap,6);
 size_t h=24+(qos?2:0)+(qos&&ht?4:0);
 const uint8_t llc[]={0xaa,0xaa,3,0,0,0,0x88,0x8e};memcpy(f+h,llc,8);
 uint8_t *p=f+h+8;p[0]=2;p[1]=3;be16(p+2,95);p[4]=2;
 unsigned flags=m==1?0x8a:m==2?0x10a:m==3?0x3ca:0x30a;be16(p+5,flags);be16(p+7,16);
 for(int i=0;i<8;i++)p[9+i]=(replay>>(8*(7-i)))&255;
 if(m!=4)memset(p+17,m==2?0x22:0x11,32);
 if(m!=1)memset(p+81,0x33,16);
 return h+8+99;
}
int main(void){
 uint8_t f[HS_FRAME_MAX];hs_key_t k;hs_store_t st={0};hs_session_t *s;
 for(int m=1;m<=4;m++)for(int qos=0;qos<2;qos++)for(int ht=0;ht<2;ht++){
  size_t n=frame(f,m,42+(m>=3),qos,ht);assert(hs_parse(f,n,ap,&k));assert(k.message==m);assert(k.replay==42u+(m>=3));assert(!memcmp(k.client,client,6));
  for(size_t cut=0;cut<n;cut++)assert(!hs_parse(f,cut,ap,&k));
 }
 /* Out-of-order, exact retransmission, completeness only after four messages. */
 const int order[]={2,2,1,4,3};
 for(unsigned i=0;i<sizeof(order)/sizeof(*order);i++){
  int m=order[i];size_t n=frame(f,m,0x10000002aULL+(m>=3),true,true);assert(hs_parse(f,n,ap,&k));s=hs_accept(&st,&k,i+1);assert(s);assert(!hs_complete(s)||i==4);
  if(i==0)assert(!hs_verifiable(s));
  if(i==2)assert(hs_verifiable(s));
 }
 assert(hs_complete(s));assert(s->frames==5);assert(st.next_id==1);
 /* Another client is independent. */
 size_t n=frame(f,1,42,false,false);f[4+5]=3;assert(hs_parse(f,n,ap,&k));assert(hs_accept(&st,&k,10)->id==2);
 /* Same counter with conflicting ANonce must disable verification. */
 n=frame(f,1,0x10000002aULL,false,false);f[24+8+17]^=1;assert(hs_parse(f,n,ap,&k));hs_session_t *conflict=hs_accept(&st,&k,11);assert(conflict->ambiguous);assert(!hs_verifiable(conflict));assert(!hs_verifiable(&st.sessions[0]));
 /* M3 + M2 alone is verifiable but never complete. */
 memset(&st,0,sizeof(st));n=frame(f,3,8,false,false);assert(hs_parse(f,n,ap,&k));s=hs_accept(&st,&k,1);assert(!hs_verifiable(s));n=frame(f,2,7,false,false);assert(hs_parse(f,n,ap,&k));s=hs_accept(&st,&k,2);assert(hs_verifiable(s)&&!hs_complete(s));
 /* NoDS headers still identify the AP, and inconsistent DS addresses reject. */
 for(int m=1;m<=2;m++){
  n=frame(f,m,7,false,false);f[1]=0;assert(hs_parse(f,n,ap,&k));assert(k.message==m);
 }
 n=frame(f,2,7,false,false);f[16+5]=8;assert(!hs_parse(f,n,ap,&k));
 n=frame(f,2,7,false,false);f[24+8+5]|=0x10;assert(!hs_parse(f,n,ap,&k));
 /* Bad direction/length/LLC/fragmentation/aggregation/protection/target. */
 n=frame(f,2,7,true,false);f[24]=0x80;assert(!hs_parse(f,n,ap,&k));
 n=frame(f,2,7,false,false);f[1]|=0x40;assert(!hs_parse(f,n,ap,&k));assert(hs_frame_target(f,n,ap));
 n=frame(f,2,7,false,false);f[1]|=4;assert(!hs_parse(f,n,ap,&k));
 n=frame(f,2,7,false,false);f[22]=1;assert(!hs_parse(f,n,ap,&k));
 n=frame(f,2,7,false,false);f[1]=3;assert(!hs_parse(f,n,ap,&k));
 n=frame(f,2,7,false,false);f[4]^=4;assert(!hs_parse(f,n,ap,&k));
 n=frame(f,2,7,false,false);f[24]=0;assert(!hs_parse(f,n,ap,&k));
 n=frame(f,2,7,false,false);f[24+8+97]=1;assert(!hs_parse(f,n,ap,&k));
 /* Descriptor v3 is captured but cannot be verified by v2 implementation. */
 memset(&st,0,sizeof(st));n=frame(f,1,7,false,false);f[24+8+6]|=1;assert(hs_parse(f,n,ap,&k));hs_accept(&st,&k,1);n=frame(f,2,7,false,false);f[24+8+6]|=1;assert(hs_parse(f,n,ap,&k));s=hs_accept(&st,&k,2);assert(!hs_verifiable(s));
 /* Bounded session eviction. */
 memset(&st,0,sizeof(st));for(unsigned i=0;i<HS_SESSIONS+2;i++){n=frame(f,1,i,false,false);assert(hs_parse(f,n,ap,&k));hs_accept(&st,&k,i+1);}assert(st.evicted==2);
 /* PCAP must refuse invalid records, accept exact validated bytes. */
 hs_record_t r={.channel=6,.time_us=1234567};memcpy(r.bssid,ap,6);r.length=frame(r.data,2,7,true,true);uint8_t out[HS_FRAME_MAX+64];size_t bytes=hs_pcap_record(&r,out,sizeof(out));assert(bytes==r.length+28u);assert(out[24]==(2437&255)&&out[25]==(2437>>8));
 r.channel=13;assert(hs_pcap_record(&r,out,sizeof(out)));assert(out[24]==(2472&255)&&out[25]==(2472>>8));
 r.channel=14;assert(!hs_pcap_record(&r,out,sizeof(out)));r.channel=6;
 assert(!hs_pcap_record(&r,out,1));r.data[4]^=1;assert(!hs_pcap_record(&r,out,sizeof(out)));
 /* Deterministic malformed-input sweep under address/undefined sanitizers. */
 unsigned seed=1234567;for(unsigned i=0;i<20000;i++){for(unsigned j=0;j<HS_FRAME_MAX;j++){seed=1664525*seed+1013904223;f[j]=seed>>24;}hs_parse(f,i%HS_FRAME_MAX,ap,&k);}
 puts("PASS protocol: directions, QoS/HT, truncation, replay64, retransmits, out-of-order, incomplete, conflicts, clients, unsupported, eviction, PCAP, 20000 malformed frames");return 0;
}
