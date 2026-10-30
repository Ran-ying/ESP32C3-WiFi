# 验证记录

## 环境（2026-10-30）

- MacBook SSH 实际 USB 枚举：USB JTAG_serial debug unit。
- esptool 实测：ESP32-C3 QFN32 revision v0.4，40 MHz，Embedded Flash 4MB (XMC)；flash_id 报告 4 MB。
- 实际检测到的端口 `/dev/cu.usbmodem1101`；只对该 C3 操作。设备 MAC 不保存于公开记录。
- 固定 SDK ESP-IDF v5.4.2。原始 Flash 备份仅存 MacBook 私有目录，不入 Git。

## M1

- JavaScript 语法检查：PASS (`node --check web/app.js`)。
- ESP-IDF v5.4.2 构建：PASS，app 0xc2d90 字节，标准 1 MiB 应用分区剩余 24%。
- Chromium UI 初始在开发容器受 socket 限制；随后移至 MacBook 临时 Chrome 上下文执行，M3 回归时通过（见下）。
- iPhone Safari、CH1/6/11 切换与重新连接：NOT TESTED，等待人工配合。

## M2

- ESP-IDF v5.4.2 构建：PASS，app 0xc50a0 字节，应用分区剩余 23%。
- `tests/run-protocol.sh`：PASS，GCC 主机 AddressSanitizer + UndefinedBehaviorSanitizer；DS 方向、QoS/HT、所有截断长度、64 位计数器、重传、乱序、非完整可验证会话、Nonce 冲突、多客户端、版本不支持、会话淘汰、导出拒绝非法帧，以及 20,000 条确定性随机输入。无堆分配的协议核心测试禁用 LeakSanitizer（环境 ptrace 限制），保留地址和未定义行为检查。
- M1 网页 JS 语法回归：PASS。
- 初期实机项目未测试；后续用户已确认真实授权网络握手捕获，见下方现场记录。PCAP 空口对照仍 NOT TESTED。

## M3 与最终回归

- 固件 ESP-IDF v5.4.2 / GCC 14.2.0 构建：PASS，app 0xc8150 字节，标准应用分区剩余 22%。
- 协议核心 ASan/UBSan 回归：PASS，另加入 NoDS、方向不一致拒绝、加密 M2 拒绝以及 CH6/13 radiotap 频率断言。
- `node tests/crypto.cjs`：PASS，SHA1、RFC2202 HMAC、RFC6070 PBKDF2、WPA PMK、Node/OpenSSL 边界长度、独立 Python PMK/PTK/MIC、正确/错误候选及非法材料。
- `node tests/worker.cjs`：PASS，无 WebCrypto、64KiB 边界、BOM/CRLF/EOF、超长/非法行、暂停/继续以及不支持握手拒绝。
- MacBook Chrome + Playwright 1.64.1，390×844 临时上下文，`http://192.168.4.1` 全部路由合成模拟：PASS。真实 Web Worker 在非 secure context 中找到已知合成密码，POST 中不含字典/结果；暂停/继续/停止；同名 SSID 的 BSSID 选择、SSID 转义、授权勾选、扫描、实际信道、配置上限为 13 时 CH13 可选与 CH14 禁用。浏览器测试不等同于实机 HTTP 或 Safari。
- 连接 C3 原始 4MB Flash 备份：PASS，仅存 MacBook 私有目录。
- M2 固件烧录：PASS，esptool 对各镜像 hash 校验成功；串口实测正常启动 APSTA、4MB、192.168.4.1 DHCP，无启动崩溃。原始串口日志含热点密码与 MAC，只保存在私有目录，不提交。
- 实机发现：ESP-IDF v5.4.2 拒绝 RU 字符串，初版地区配置启动检查失败。已取消国家选择，改用中性代码 01 + 显式 MANUAL 1–13；修正后实机读回 1–13、APSTA/DHCP 正常，8 秒观察窗口仅一次启动，用户指定热点密码生效。该结果不表示 CH13 切换已经测试。
- 最终简化界面版本：PASS，esptool 写入并校验 hash；串口读回 Configured channels=1-13、APSTA、192.168.4.1 DHCP、app_main 正常返回，8 秒观察窗口一次启动、用户指定密码生效。仅这些实际观察项为 PASS。
- 现场验收按下方用户反馈逐项更新；CH11、不重启、PCAP 独立对照与实网已知密码验证仍 NOT TESTED。路由器由用户固定信道，没有将该操作算作设备测试通过。
- GitHub Actions：首次运行已完成，两个 job 均 SUCCESS，见下方记录。

本记录中的协议/密码学夹具都是合成数据，不含真实网络握手、密码或用户测试路由器标识。

## 现场验收进展（用户反馈）

- 2026-10-30：用户确认新版热点可加入，iPhone Safari 能打开网页；正在扫描和选择自己的测试网络。仅首屏可访问记为 PASS，选择目标、信道切换、监听与密码验证仍待反馈。
- 首次 [GitHub Actions 运行](https://github.com/Ran-ying/ESP32C3-WiFi/actions/runs/41109404973)：`protocol-and-browser` 与 `firmware` 两个 job 均 SUCCESS。CI 在官方 v5.4.2 容器从源码构建默认 CH1–11 固件，并运行协议、密码学、Worker 与 Chromium HTTP UI 测试。

- 2026-10-30，用户确认 CH6 切换成功。页面信息恢复后需要手动刷新；已记录轮询恢复问题与切换弹窗需求，按用户要求先完成功能测试，再处理交互。启动标识/连续运行时间未确认，不能据此判定“不重启”通过。
- 2026-10-30，用户报告两个客户端、共 8 条认证帧；随后确认两个客户端的 M1/M2/M3/M4 均 RECEIVED，状态 COMPLETE。授权网络的被动 EAPOL 捕获与页面握手展示记为用户实测 PASS；尚不等于 MIC/密码验证通过。未保存或提交真实握手、MAC、SSID、密码。

## 数字预设、断线恢复与捕获保留（2026-10-30）

- ESP-IDF v5.4.2 构建：PASS，app 0xca2d0 字节，应用分区剩余 21%。
- 协议 ASan/UBSan 与原有密码学回归：PASS，记录见 presets-protocol.log / presets-crypto.log。
- Worker：PASS，保留 TXT 测试；新增真实 MIC 的 numeric8 合成夹具、前导零、闭区间终点 99999999、进度、暂停/继续与无效范围，见 presets-worker.log。
- Chromium 390×844、普通 HTTP、真实 Worker：PASS，TXT/数字两种来源与不上传候选；切换弹窗确认/取消/成功；模拟请求永久挂起后超时恢复；pageshow 中止旧请求后恢复；页面重载自动加载设备捕获且不自动恢复授权，见 presets-ui.log。
- 固件在同一 BSSID/信道/SSID/安全配置恢复监听时保留现有会话、PCAP 环形缓冲和计数；更换目标开始新批次。数据为 RAM，不能跨 MCU 重启/烧录保留。该固件保留行为的真实空口复测尚待用户完成。
- 新版烧录/启动：PASS。最终 app SHA256 `2ec21fe8825dc10e7de279eacbbaf2064d67583ea29975ebfbb186c13449b0ea`，828112 字节；esptool verify_flash 对整个应用镜像报告 digest matched。实测 APSTA、CH1–13、192.168.4.1 DHCP、app_main 正常返回，8 秒观察窗口一次启动，用户指定私有密码生效。
- 交付中首次烧录取到了上一份构建，最终镜像校验发现版本不一致；已使用完整传输并通过 SHA256 的文件重新烧录，随后 verify_flash 成功。没有将首次写入当作最终校验通过。
- iPhone Safari 新弹窗、数字预设与自动恢复：NOT TESTED。之前 CH6 与完整握手的用户报告属于上个固件版本，不能当成新版新增功能实测。

## 独立 PCAP 并行 HTML（2026-10-30）

- 文件 `standalone/wpa2-parallel.html`，所有源码、CSS、密码学、解析器与 Blob Worker 内嵌；构建检查确保交付文件与源码一致。固件源码与镜像不变，本次没有烧录硬件。
- `npm test`：PASS，包括原有密码学与数字 Worker 回归、新 PCAP/PCAPNG 解析、候选划分、原生/JS 验证与无 WebCrypto 回退；详见 standalone-unit.log。
- 解析夹具覆盖 PCAP 大小端、微秒/纳秒、DLT105/127、PCAPNG EPB/SPB/大小端/多 section/未知块、QoS/HT/radiotap 扩展与 padding、重传、缺失 SSID、冲突、算法不支持和损坏长度。文件没有结尾换行时必须正确结束，不重复读取末尾缓冲。
- Chromium `file://` + offline context：PASS，真实 1/4 Worker 运行、64 候选全部覆盖、实际 MIC 匹配、TXT/数字、暂停/继续/停止、SSID/Nonce 缺失禁用，以及零 HTTP 请求。详见 standalone-ui.log。
- 开发 VM Chromium 156.0.8078.47 小样本测速，64 个错误候选、含 Worker 启动开销：JS 1 Worker 约 8.0/s，4 Worker 约 11.4/s；原生 PBKDF2 1 Worker 约 173.9/s，4 Worker 约 212.2/s。仅是这台 VM 的短样本，不表示 iPhone 性能或线性加速；详见 standalone-benchmark.log。首次 512 候选纯 JS 样本超过 60 秒测试超时，缩小到 64 候选后四种配置均完整结束。
- 真实 iPhone Safari、本用户导出的 PCAP 与实际密码：NOT TESTED。使用的所有 PCAP 测试数据来自合成夹具，不保存真实标识或密码。
