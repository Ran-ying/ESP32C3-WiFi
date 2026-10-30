# 架构与边界

- `lab_wifi`：唯一 Wi-Fi 控制任务，APSTA；STA 不连接任何网络。操作串行化。扫描结束必须重新选择目标才恢复捕获。选择只接受最近扫描列表中的 BSSID，明确授权后排队，先返回 HTTP 202，再等待 1.2 秒停止 HTTP 和 Wi-Fi，修改 AP 配置，重启并读取真实信道。失败明确显示 ERROR，不重启 MCU。
- `sniffer`：官方 promiscuous API，只启用 DATA 过滤。Wi-Fi 回调检查 BSSID/实际接收信道、帧头和 LLC EtherType，以零等待方式复制到 12 项队列。解析任务执行完整 EAPOL 校验；不用回调执行 HTTP、NVS 或密码学。
- `handshake`：无 SDK 依赖的 C 解析核心，可在主机上运行 sanitizers。支持 ToDS/FromDS/NoDS、QoS 和带 Order 的 HT Control。拒绝 WDS、分片、A-MSDU 和加密载荷，不能声称覆盖所有 802.11 变体。
- `web`：静态资源编入固件，2 秒 HTTP 轮询；SSID 使用 textContent，不生成 HTML。写操作要求本地 Host、自定义请求头及匹配的 Origin（如果提供）；AP 密码控制访问，不实现跨网络远程控制。

## 关联规则

只解析 RSN EAPOL-Key（descriptor type 2），保留原始 EAPOL、MIC、Key Information、版本、64 位 Replay Counter、AP/客户端与 Nonce。M1/M2 使用同一 Replay Counter；M3/M4 必须对应前者 +1。支持乱序、相同报文重传和多个客户端。相同客户端/基础计数器有不同 Nonce 或验证数据时标记冲突，禁止猜测会话关系。对不符合此计数模式的设备可能显示多个不完整会话，不合并。

- CAPTURED：有消息，验证材料不齐或关联有冲突。
- VERIFIABLE：已关联 ANonce、M2 的 SNonce/MIC/原始 EAPOL，明确支持的算法，非隐藏 SSID；不要求四条消息齐全。
- COMPLETE：以上条件成立且 M1–M4 均被捕获。仅表示捕获齐全，未声称 MIC 已通过密码验证。
- UNSUPPORTED：未明确支持的安全模式/描述符版本。目前仅 WPA2-PSK + CCMP + descriptor version 2 可验证；WPA/TKIP、WPA3、Enterprise、FT、SHA256 AKM 不纳入第一版。

## 有界存储与导出

RAM 保留 8 个会话，按最后接收时间淘汰；24 条原始认证帧环形缓冲，满时覆盖最旧记录；单帧上限 768 字节，EAPOL 上限 512 字节。分别报告队列丢失、超长丢弃、覆盖和会话淘汰。切换目标时更新 generation、清空本次统计，旧队列项按 generation 丢弃。扫描暂停而不清空已保存记录。

PCAP 导出在持有存储锁的快照中逐条重新校验，采用 DLT_IEEE802_11_RADIO (127)，radiotap 每条包含实际接收频率；802.11 帧带有真实 BSSID。FCS 从 SDK 的 sig_len 尾部去除，无 FCS 的 radiotap 不设置 FCS-present。时间是启动后单调微秒，不是 UTC，分析软件可能显示 1970 年。结构化 JSON 附 generation、接收信道/BSSID、记录长度/时间和消息元数据；两次单独 HTTP 导出是各自独立快照，不保证记录编号一一对应。

目标元数据保存在 NVS，但开机不自动恢复监听授权。热点保持标准信标/手机网络服务，STA 从不连接目标，不调用原始帧发送或 deauth API。SoftAP 与监听共享单射频；拥塞、扫描、Safari 轮询和无线丢包会导致握手缺失，缓冲无丢失不等于空口无丢失。
