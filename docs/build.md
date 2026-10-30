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

## 主机与浏览器测试

```sh
bash tests/run-protocol.sh     # C11 + ASan/UBSan；协议核心无堆分配
node tests/crypto.cjs
node tests/worker.cjs
npm install                   # 仅开发测试依赖，不是设备运行依赖
npx playwright install chromium  # 或设置 CHROME_BIN 使用现有 Chrome
CHROME_BIN=/path/to/chrome npm run test:ui
```

UI 测试使用临时浏览器上下文，将 http://192.168.4.1 的 API 全部替换为合成数据；不连接或捕获实际网络，也不访问日常 Chrome profile。测试真实 Worker 与非安全 HTTP 页面，不能代替 iPhone Safari 实测。

menuconfig → Wi-Fi laboratory → Maximum permitted 2.4 GHz channel 设置安装地允许的上限，默认 11，本次俄罗斯部署为 13。不需要用户填写国家代码。内部使用中性驱动代码 01、显式 1–上限、MANUAL，并通过 get_country 检查实际范围；目标切换使用扫描得到的信道。CH14 与 5 GHz 不在本项目支持范围。

实测发现 ESP-IDF 5.4.2 的两种 country API 均拒绝 RU 字符串，早期 RU 配置曾导致启动检查失败；已取消国家选项并使用上述显式范围。驱动内部参数仍然存在，不能理解为关闭射频法规限制。

共享浏览器资源更新后，构建固件前执行：

```sh
python3 tools/build-web-shared.py
python3 tools/build-standalone.py
```

生成的两个 `web/parallel*.js` 已纳入仓库并由 ESP-IDF 静态嵌入，运行时不需要 Python、Node 或外部资源。
