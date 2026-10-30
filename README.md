# ESP32C3-WiFi

便携式 Wi-Fi 协议与密码强度教学实验台。ESP-IDF v5.4.2，C 固件，本地 HTML/CSS/JavaScript。仅对自己拥有或明确授权的 2.4 GHz 测试网络被动接收认证帧。没有断连、伪造 AP、强制重连或原始帧发送功能。

## 当前状态

| 里程碑 | 软件 | 实机验收 |
| --- | --- | --- |
| M1 APSTA / 扫描 / UI / 信道切换 | 已实现，验证见 docs/test-results.md | CH1/6/11 + iPhone Safari 待测试 |
| M2 被动 EAPOL 分析 / 导出 | 开发中 | NOT TESTED |
| M3 手机本地密码验证 | 开发中 | NOT TESTED |

## 构建与使用

详见 [构建说明](docs/build.md)、[验收步骤](docs/hardware-test.md)。不使用 Arduino、CDN 或云服务。首次启动通过串口取得随机热点密码，手机加入 `ESP32C3-Auditor`，Safari 打开 `http://192.168.4.1`。

热点密码可在 `idf.py menuconfig` → Wi-Fi laboratory 配置；`sdkconfig` 不进 Git。留空时生成 16 位随机密码并保存到 NVS。串口日志含本机热点密码，请勿公开。目标元数据保存在 NVS；每次开机必须重新选择并确认授权才开始监听。

单射频扫描会离开工作信道；扫描暂停监听，结束后需重新选择目标。仅支持信道 1–11，以适配通用 2.4 GHz 实验环境。路由器必须固定信道，自动换信道不会自动追踪。
