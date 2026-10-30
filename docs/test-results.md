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
- 实际授权网络 EAPOL、iPhone 实时展示、PCAP 空口对照：NOT TESTED。

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
- iPhone Safari 中的实机 CH1/6/11 切换、不重启、实际授权网络 EAPOL、实网已知密码字典验证：NOT TESTED，须按 hardware-test.md 人工执行。路由器由用户固定信道；没有将该操作算作设备测试通过。
- GitHub Actions：首次运行已完成，两个 job 均 SUCCESS，见下方记录。

本记录中的协议/密码学夹具都是合成数据，不含真实网络握手、密码或用户测试路由器标识。

## 现场验收进展（用户反馈）

- 2026-10-30：用户确认新版热点可加入，iPhone Safari 能打开网页；正在扫描和选择自己的测试网络。仅首屏可访问记为 PASS，选择目标、信道切换、监听与密码验证仍待反馈。
- 首次 [GitHub Actions 运行](https://github.com/Ran-ying/ESP32C3-WiFi/actions/runs/41109404973)：`protocol-and-browser` 与 `firmware` 两个 job 均 SUCCESS。CI 在官方 v5.4.2 容器从源码构建默认 CH1–11 固件，并运行协议、密码学、Worker 与 Chromium HTTP UI 测试。
