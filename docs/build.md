# 构建说明

固定 ESP-IDF **v5.4.2**（commit f5c3654a1c2d2a01f7f67def7a0dc48e691f63c0），目标 esp32c3；官方工具链 riscv32-esp-elf GCC 14.2.0 / esp-14.2.0_20241119。

```sh
git clone --branch v5.4.2 --recursive https://github.com/espressif/esp-idf.git ~/esp-idf-v5.4.2
cd ~/esp-idf-v5.4.2
./install.sh esp32c3
. ./export.sh
cd ~/ESP32C3-WiFi
idf.py set-target esp32c3
idf.py menuconfig
idf.py build
```

先用 `python -m serial.tools.list_ports -v` 发现端口，再用 `esptool.py --port <实际端口> chip_id`、`flash_id` 确认 C3 和容量。不要照抄其他板子的端口。默认配置 4 MB，必须与实际容量核对。

```sh
idf.py -p <实际C3端口> flash monitor
```

标准分区表：NVS、PHY、单应用。可烧录 `build/flasher_args.json` 中的全部镜像，禁止仅复制 app bin 当作完整 Flash。烧录前建议 `esptool.py ... read_flash 0 <实际容量> original.bin` 保存私有备份。

本开发机独立环境位于 `/root/esp-idf-c3-v5.4.2` 与 `/root/.espressif-c3`；不改动 ESP32-flash 仓库。

官方 API 依据：https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32c3/api-reference/network/esp_wifi.html 。切换流程先结束扫描，再停止 Wi-Fi，设置 AP 配置的 channel 后启动；不在扫描、AP 客户端连接或 STA 连接状态中调用 set_channel。STA 从不调用 connect。
