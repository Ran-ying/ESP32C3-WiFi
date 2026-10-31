# ESP32C3-WiFi

便携式 Wi-Fi 协议与密码强度教学实验台。ESP-IDF v5.4.2，C 固件，本地 HTML/CSS/JavaScript。仅对自己拥有或明确授权的 2.4 GHz 测试网络被动接收认证帧。没有断连、伪造 AP、强制重连或原始帧发送功能。

## 当前状态

| 里程碑 | 软件 | 实机验收 |
| --- | --- | --- |
| M1 APSTA / 扫描 / UI / 信道切换 | 编译、手机尺寸浏览器模拟通过 | C3 启动/DHCP、Safari 首屏、CH6 切换用户确认；CH11/不重启待测 |
| M2 被动 EAPOL 分析 / 导出 | 已实现；主机协议测试与固件编译通过 | 用户确认：2 个客户端、8 条认证帧、M1–M4 全部 RECEIVED / COMPLETE；PCAP 对照待测 |
| M3 手机本地密码验证 | 标准向量、独立夹具、Worker 与普通 HTTP 浏览器测试通过 | iPhone + 实际握手 NOT TESTED |

## 构建与使用

详见 [构建说明](docs/build.md)、[验收步骤](docs/hardware-test.md)。不使用 Arduino、CDN 或云服务。首次启动通过串口取得随机热点密码，手机加入 `ESP32C3-Auditor`，Safari 打开 `http://192.168.4.1`。

热点密码可在 `idf.py menuconfig` → Wi-Fi laboratory 配置；`sdkconfig` 不进 Git。留空时生成 16 位随机密码并保存到 NVS。串口日志含本机热点密码，请勿公开。目标元数据保存在 NVS；每次开机必须重新选择并确认授权才开始监听。

单射频扫描会离开工作信道；扫描暂停监听，结束后需重新选择目标。网页无需填写国家代码：选择目标后自动读取其信道并切换。安装时配置合法信道上限，默认 1–11；本次俄罗斯部署为 1–13。网页显示实际信道与可用范围。路由器必须固定信道，自动换信道不会自动追踪。

实现说明见 [架构](docs/architecture.md)、[密码学验证](docs/crypto.md) 和 [测试记录](docs/test-results.md)。`COMPLETE` 表示四条报文捕获齐全；密码是否匹配由手机实际验证 MIC 决定。RAM 有界，缺失、冲突和溢出均明确显示，不推测补全。

GitHub Actions 可构建默认 CH1–11 固件并保留镜像附件；私有热点密码配置不上传。开发机为本站点配置 CH1–13 的固件仅保存在本地与连接硬件的 MacBook。

首次 [完整 CI 已通过](https://github.com/Ran-ying/ESP32C3-WiFi/actions/runs/41109404973)，可在运行页面下载 `esp32c3-firmware-ch1-11`。这是无私有密码的默认构建；当前硬件使用本站点 CH1–13 的本地配置。

## 本地候选与连接恢复

- 预设“8 位纯数字”：Worker 按需从 `00000000` 到 `99999999` 顺序生成，不创建字典文件；可指定 8 位起止值，边界包含在内。完整范围 1 亿个候选，界面显示速度、进度与预计剩余时间。
- 保留本地 TXT 来源、暂停/继续/停止；两种来源都只在手机中验证，不上传候选或结果。
- 切换目标先弹窗确认，显示目标、信道和重连步骤，再自动核实成功。HTTP 请求有 4 秒超时，恢复网络或返回页面时重新轮询。
- 设备 RAM 保留当前目标的最新捕获。手机重连/刷新后自动加载最近的可验证会话；重新选择同一 BSSID、信道及安全配置保留抓包，generation 仍更新以确认监听已恢复。换目标开始新批次，避免混合接收信道；断电、重启或烧录会丢失 RAM 捕获。验证运行中仍固定所选会话快照。

## 独立 PCAP 并行 HTML

[standalone/wpa2-parallel.html](standalone/wpa2-parallel.html) 是可单独保存并打开的完整 HTML，不依赖 ESP32、服务器、CDN 或互联网。导入授权 PCAP/PCAPNG，选择握手，填写抓包缺少的 SSID，设置 1–256 个并行 Worker，选择数字范围或本地 TXT 后运行。默认优先浏览器原生 PBKDF2，不可用时使用纯 JS。详见 [独立页面说明](standalone/README.md)。

## 设备网页并行验证与生日预设

设备 HTTP 页面也支持 1–256 个并行 Worker、本地 PCAP/PCAPNG 导入、数字范围、八位生日与 TXT。生日按有效公历日期生成，含起止日期，支持 YYYYMMDD / DDMMYYYY / MMDDYYYY，不生成 1900-02-29 等无效日期。网络行左侧显示 SSID/BSSID/信道/RSSI/加密方式，右侧仅“切换”。

`http://192.168.4.1` 通常没有 Web Crypto，自动模式会使用纯 JS；并行运算都在手机上。浏览器关闭不影响 ESP32 的监听/帧解析，但浏览器内的 PCAP 解析、候选生成与密码验证会停止。扫描会暂停监听，完成后需重新选择目标恢复；抓包仅 RAM，有界覆盖。

两种页面共享解析器、候选源、密码学引擎与 Worker 池。修改共享代码后执行 `python3 tools/build-web-shared.py` 和 `python3 tools/build-standalone.py` 重新生成交付资源；`npm test` 会检查资源同步。

## Node 版与断点续跑

[cli/wpa2.cjs](cli/wpa2.cjs) 提供原生 Node 并行命令行版，无运行时 npm 依赖。支持 PCAP/PCAPNG、数字、生日、有限正则和 TXT；参数示例见 [CLI 说明](cli/README.md)。

设备网页和独立 HTML 均增加正则来源、运行中调整 Worker，以及相同候选源/握手下暂停或停止后的“开始”断点继续。页面刷新/关闭会清除计算断点；ESP32 的监听及 RAM 捕获继续独立运行。
