# 验证记录

## 环境（2026-10-30）

- MacBook SSH 实际 USB 枚举：USB JTAG_serial debug unit。
- esptool 实测：ESP32-C3 QFN32 revision v0.4，40 MHz，Embedded Flash 4MB (XMC)；flash_id 报告 4 MB。
- 实际检测到的端口 `/dev/cu.usbmodem1101`；只对该 C3 操作。设备 MAC 不保存于公开记录。
- 固定 SDK ESP-IDF v5.4.2。原始 Flash 备份仅存 MacBook 私有目录，不入 Git。

## M1

- JavaScript 语法检查：PASS (`node --check web/app.js`)。
- ESP-IDF v5.4.2 构建：PASS，app 0xc2d90 字节，标准 1 MiB 应用分区剩余 24%。
- Chromium UI 模拟测试：BLOCKED，执行环境禁止浏览器所需的 socket；测试脚本已提供，未记 PASS。
- iPhone Safari、CH1/6/11 切换与重新连接：NOT TESTED，等待人工配合。

## M2

- ESP-IDF v5.4.2 构建：PASS，app 0xc50a0 字节，应用分区剩余 23%。
- `tests/run-protocol.sh`：PASS，GCC 主机 AddressSanitizer + UndefinedBehaviorSanitizer；DS 方向、QoS/HT、所有截断长度、64 位计数器、重传、乱序、非完整可验证会话、Nonce 冲突、多客户端、版本不支持、会话淘汰、导出拒绝非法帧，以及 20,000 条确定性随机输入。无堆分配的协议核心测试禁用 LeakSanitizer（环境 ptrace 限制），保留地址和未定义行为检查。
- M1 网页 JS 语法回归：PASS。
- 实际授权网络 EAPOL、iPhone 实时展示、PCAP 空口对照：NOT TESTED。
