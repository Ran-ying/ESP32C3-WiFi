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
