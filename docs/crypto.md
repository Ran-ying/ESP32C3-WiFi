# 浏览器验证算法与测试

第一版仅支持 WPA2-Personal / CCMP、RSN descriptor type 2、Key Descriptor Version 2。MIC 算法为 HMAC-SHA1 截断到前 16 字节。WPA/TKIP 的 HMAC-MD5、版本 3 的 AES-CMAC、WPA3/SAE、FT、SHA256 AKM 均不支持，不尝试替代算法。

1. `PMK = PBKDF2-HMAC-SHA1(passphrase, SSID原始字节, 4096, 32)`。
2. 将 AP/客户端 MAC 和 ANonce/SNonce 各自按字节排序，组成 PTK 的上下文。
3. 对 `Pairwise key expansion || 0x00 || 上下文 || 计数器(0起)` 使用 HMAC-SHA1 PRF，导出 PTK，前 16 字节为 KCK。
4. 校验收到的 M2 EAPOL 声明长度、Nonce、MIC 和描述符字段一致，然后仅将 EAPOL 的 MIC 字段（偏移 81、长度 16）清零。
5. 使用 KCK 计算上述 EAPOL 的 HMAC-SHA1-128，与捕获的 MIC 对比。任何缺失或冲突材料都不补全。

`web/crypto.js` 是独立纯 JS 实现；不调用 Web Crypto，不使用 CDN。SHA1 用于 WPA2 协议的规定算法。公开向量与独立实现交叉测试不能替代密码学审计；此版本用于受控教学实验。

## 验证依据

- [RFC 6070](https://www.rfc-editor.org/rfc/rfc6070)：PBKDF2-HMAC-SHA1 的公开测试向量（1/2/4096 次、含 NUL、25 字节派生长度；不运行耗时的 16,777,216 次向量）。
- [RFC 2202](https://www.rfc-editor.org/rfc/rfc2202)：HMAC-SHA1 测试向量。
- [hostap 参考实现](https://w1.fi/cgit/hostap/tree/src/common/wpa_common.c)：WPA 密钥派生与 MIC 算法参考；报文字段参考同目录 wpa_common.h。实现不是从该源码复制。
- `tests/generate-fixture.py` 使用 Python 标准库 `hashlib.pbkdf2_hmac` / `hmac` 独立生成完整合成夹具。`tests/fixtures/wpa2-synthetic.json` 的 MAC、SSID、Nonce 和密码全部人工合成。它不是实网握手。
- `tests/crypto.cjs` 对照固定向量、Python PMK/PTK/MIC 及 Node/OpenSSL 的 SHA/HMAC 边界长度，并验证正确、错误候选与畸形输入。

## 字典与数据

字典通过 `File` 传给专用 Web Worker，每次读取 64 KiB。每行一个候选，支持 LF/CRLF、文件首 UTF-8 BOM 和末尾无换行；不 trim 空格。只验证 8–63 字节可打印 ASCII，空行/超长行/非 ASCII 被计数并跳过。不支持 64 位十六进制原始 PSK。进度按处理的文件字节计算，候选数只计实际完成密码学计算的条目。

暂停在候选之间生效，已读取的候选保留待恢复；停止立即 terminate Worker，再开始会从文件头重新执行。平均速度排除暂停时间。Safari 切至后台可能挂起计算，速度不是性能保证。匹配结果只存在当前页面内存，刷新消失。无上传接口、无本地持久化、无结果写回 ESP32。

SSID 为扫描得到的原始字节，JSON 使用十六进制，避免 UTF-8 转换改变 PMK 盐值。隐藏 SSID 与含嵌入 NUL 而无法由扫描 API 完整表达的 SSID 不在第一版验证范围。加载的会话是点击“加载当前捕获”时的快照；验证运行中固定该快照，不因后续空口报文而替换 Nonce。

## 按需数字预设

Worker 支持 `numeric8` 来源，默认含前导零的 `00000000` 至 `99999999`，总计 100,000,000 个候选。起止值必须是 8 位数字且起始不大于结束，两个端点均计入。逐个字符串生成，不分配完整数组或字典文件，沿用完全相同的 WPA2 MIC 验证函数。数字模式进度按已验证候选数、TXT 按已处理字节；预计剩余时间排除暂停时长。停止后重新开始从所选起始值执行。

合成 `wpa2-numeric.json` 用 Python 独立计算，已知密码为 `00000002`。Worker 测试以范围 `00000000`–`00000003` 完成真实 MIC 正误验证；另测试前导零、末端 `99999999`、闭区间、暂停/继续和无效范围。不会为了测试而跑完整一亿候选。

## 生日与设备页面并行

生日源通过 UTC 日历按天遍历，不受夏令时影响；明确验证日期边界，公历规则处理世纪闰年。1900-02-28 至 1900-03-01 共 2 个，2000 年同范围共 3 个。格式支持 YYYYMMDD、DDMMYYYY、MMDDYYYY，全部 8 位。任务按批次动态分配给多个 Worker，不重复区间；小范围最多启动候选数那么多 Worker。手机页面保留 TXT、数字来源、暂停/继续/停止及逐 Worker 统计。

手机 HTTP 页面与独立 HTML 复用 `standalone/src/` 的 PCAP 解析、候选源和 Worker 池，通过构建脚本打包至 `web/parallel.js` 与 `web/parallel-worker.js`。原 `/worker.js` 保留用于旧页面兼容；新版页面使用并行入口。普通 HTTP 不假定 Web Crypto 可用，自动回退纯 JS。PCAP 与候选通过浏览器的 Worker 消息传递，不 POST 到设备。
