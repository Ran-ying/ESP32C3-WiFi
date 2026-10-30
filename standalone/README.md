# 本地 PCAP 并行验证页

交付文件：**[wpa2-parallel.html](wpa2-parallel.html)**。下载这一份 HTML 即可，使用现代浏览器打开；无需启动 ESP32 或安装运行时依赖。所有静态资源、密码学代码、解析器和 Blob Worker 都包含在文件内，CSP 禁止网络连接。

## 使用

1. 导入自己拥有或获授权的 PCAP / PCAPNG，选择握手会话。
2. 确认 SSID。可以从 beacon/probe response 获取；**ESP32 的仅认证帧导出通常不含 SSID，需要手动输入原始名称**。非 UTF-8 SSID 可切换 HEX 原始字节输入。不会推测缺失的 Nonce、M2 或 MIC。
3. 选择 8 位纯数字闭区间（包含前导零）或手机/电脑本地 TXT。TXT 每行一个候选，支持 BOM、LF/CRLF 和末尾无换行，保留空格，跳过非法行。密码范围为 8–63 字节可打印 ASCII。
4. 自由设置 1–256 个 Worker，默认取浏览器报告的逻辑核数。数字任务切分为不重复的小区间动态分配；TXT 读取一次并分批分配。候选较少时数字模式最多启动候选数那么多 Worker。
5. 默认选择“自动”，可用时用浏览器原生 PBKDF2-HMAC-SHA1，否则纯 JS。可手动选择引擎比较速度。原生 PBKDF2 仍按 WPA2 要求执行 4096 次；PTK/KCK/MIC 在本地计算。
6. 开始后显示总体速度、已回报数量、进度和各 Worker 的状态；暂停/继续保留进度，停止后再开始从头执行。数字模式显示 ETA；TXT 总候选数未知，进度按已完成批次的连续文件字节前沿，不把提前读取的字节当作已经验证。

完整数字范围有一亿个候选。Worker 数量与实际计算并行度不是同一件事；原生密码学后端、CPU 与浏览器调度都会影响加速。并行匹配可能先返回字典中较后的位置。结果只存在当前页面，关闭后清除。停止时立即结束 Worker，计数为已收到的最新进度回报。

## 支持范围与限制

- PCAP：大小端、微秒/纳秒文件头；DLT_IEEE802_11 (105) 和 DLT_IEEE802_11_RADIO (127)。PCAPNG：SHB、IDB、EPB、SPB、大小端与多 section/interface；未知块按长度校验后跳过。其他链路类型明确拒绝。
- radiotap：读取前四种字段（TSFT、Flags、Rate、Channel）并处理 extended present、对齐、FCS-present、BADFCS 与数据 padding。根据头长度跳过后续字段。不会宣称完整 radiotap 解码或软件 CRC 校验。
- WPA2-Personal / CCMP / 描述符版本 2，需从 M2 RSN IE 或捕获的 AP RSN IE 确认算法。缺少算法证据显示 NOT TESTED 并禁止开始；WPA/TKIP、WPA3、FT、Enterprise、其他描述符版本不支持。
- 支持 QoS/HT Control，拒绝 WDS、分片、A-MSDU、加密载荷。按 section/interface、接收信道、AP、客户端和完整 64 位 Replay Counter 保守关联；冲突禁用验证。不会跨接口/信道猜测合并。
- 捕获齐全不等于 MIC 已验证。失败连接的 M1+M2 所匹配的可能是终端尝试的错误密码，不单独证明 AP 接受。建议用成功连接的完整握手验收。
- 读取文件以 64KiB 缓冲流式执行；捕获记录最多 256KiB，必要 PCAPNG 块最多 1MiB，最多 2048 个会话/网络、256 个接口。超限明确报错，请先裁剪捕获。只保留认证数据和必要元数据，不将整个抓包复制给每个 Worker。
- 已测试桌面 Chromium 的 `file://` 单文件离线运行；真实 iPhone Safari 尚未测试。iOS“文件”App 的预览不等同于完整 Safari 页面执行环境；浏览器须能执行本地 HTML、Blob Worker 和 File API。

## 源码与测试

```sh
python3 tools/build-standalone.py
python3 tools/build-standalone.py --check
node tests/standalone.cjs
CHROME_BIN=/path/to/chrome node tests/standalone-ui.cjs
```

`src/` 是单文件的可维护源码，构建时复用仓库 `web/crypto.js`，没有第三方运行时下载。改源码后必须重新构建 HTML。测试夹具由合成 MAC、Nonce、SSID 与公开的合成密码生成，不含实际网络抓包。

格式依据：[PCAP 格式草案](https://www.ietf.org/archive/id/draft-ietf-opsawg-pcap-06.html)、[PCAPNG 格式草案](https://www.ietf.org/archive/id/draft-ietf-opsawg-pcapng-05.html)、[radiotap](https://www.radiotap.org/)。草案是格式工作文档，并非声称已发布 RFC。

## 已验证结果

主机解析/密码学测试与离线 Chromium 单文件测试通过，包括实际 1/4 Worker、数字和 TXT 的正误候选、暂停/恢复/停止及无网络请求。开发 VM 的 64 候选短样本（含启动）约为：JS 单 Worker 8/s、四 Worker 11/s；原生 PBKDF2 单 Worker 174/s、四 Worker 212/s。默认优先原生引擎，实际设备请按界面速度评估。测试细节见仓库 `docs/standalone-*.log`；iPhone Safari 实测仍未完成。
