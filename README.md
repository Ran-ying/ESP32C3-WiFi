# ESP32C3-WiFi

便携式 Wi-Fi 协议与密码强度教学实验台。ESP-IDF v5.4.2，C 固件，本地 HTML/CSS/JavaScript。仅对自己拥有或明确授权的 2.4 GHz 测试网络被动接收认证帧。没有断连、伪造 AP、强制重连或原始帧发送功能。

## 当前状态

| 里程碑 | 软件 | 实机验收 |
| --- | --- | --- |
| M1 APSTA / 扫描 / UI / 信道切换 | 编译、手机尺寸浏览器模拟通过 | C3 启动/DHCP、Safari 首屏已测；CH1/6/11 切换待测 |
| M2 被动 EAPOL 分析 / 导出 | 已实现；主机协议测试与固件编译通过 | 空口握手捕获 NOT TESTED |
| M3 手机本地密码验证 | 标准向量、独立夹具、Worker 与普通 HTTP 浏览器测试通过 | iPhone + 实际握手 NOT TESTED |

## 构建与使用

详见 [构建说明](docs/build.md)、[验收步骤](docs/hardware-test.md)。不使用 Arduino、CDN 或云服务。首次启动通过串口取得随机热点密码，手机加入 `ESP32C3-Auditor`，Safari 打开 `http://192.168.4.1`。

热点密码可在 `idf.py menuconfig` → Wi-Fi laboratory 配置；`sdkconfig` 不进 Git。留空时生成 16 位随机密码并保存到 NVS。串口日志含本机热点密码，请勿公开。目标元数据保存在 NVS；每次开机必须重新选择并确认授权才开始监听。

单射频扫描会离开工作信道；扫描暂停监听，结束后需重新选择目标。网页无需填写国家代码：选择目标后自动读取其信道并切换。安装时配置合法信道上限，默认 1–11；本次俄罗斯部署为 1–13。网页显示实际信道与可用范围。路由器必须固定信道，自动换信道不会自动追踪。

实现说明见 [架构](docs/architecture.md)、[密码学验证](docs/crypto.md) 和 [测试记录](docs/test-results.md)。`COMPLETE` 表示四条报文捕获齐全；密码是否匹配由手机实际验证 MIC 决定。RAM 有界，缺失、冲突和溢出均明确显示，不推测补全。

GitHub Actions 可构建默认 CH1–11 固件并保留镜像附件；私有热点密码配置不上传。开发机为本站点配置 CH1–13 的固件仅保存在本地与连接硬件的 MacBook。

首次 [完整 CI 已通过](https://github.com/Ran-ying/ESP32C3-WiFi/actions/runs/41109404973)，可在运行页面下载 `esp32c3-firmware-ch1-11`。这是无私有密码的默认构建；当前硬件使用本站点 CH1–13 的本地配置。
