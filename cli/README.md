# Node 原生并行验证

Node.js 22+，无运行时 npm 依赖。使用系统自带的 Node 即可，不需要浏览器或 ESP32 在线。只读取自己的授权 PCAP，在本地执行 PBKDF2-HMAC-SHA1(4096)、KCK 派生与实际 M2 MIC 校验，不发送网络请求或无线帧。

从仓库根目录执行：

```sh
node cli/wpa2.cjs --help
node cli/wpa2.cjs --pcap /path/to/capture.pcap --list
```

如果抓包包含多个可验证会话，用 `--session ID` 明确选择。ESP32 导出的认证帧通常不包含 SSID，需提供 `--ssid`；原始非 UTF-8 字节可用 `--ssid-hex`。不得推测缺失的 Nonce 或 M2。

```sh
# 八位数字范围，包含两个端点和前导零
node cli/wpa2.cjs --pcap capture.pcap --ssid Lab --session 1 \
  --source numeric --start 00000000 --end 00009999 --workers 8 --authorized

# 有效公历生日，支持 YYYYMMDD / DDMMYYYY / MMDDYYYY
node cli/wpa2.cjs --pcap capture.pcap --ssid Lab --session 1 \
  --source birthday --from 1900-01-01 --to 2026-12-31 \
  --format YYYYMMDD --workers 8 --authorized

# 有限正则生成，不是对全数字范围再逐一过滤
node cli/wpa2.cjs --pcap capture.pcap --ssid Lab --session 1 \
  --source regex --regex '^test[0-9]{4}$' --workers 8 --authorized

# TXT 流式读取；保留空格，支持 BOM/CRLF 和末尾无换行
node cli/wpa2.cjs --pcap capture.pcap --ssid Lab --session 1 \
  --source file --dictionary local.txt --workers 8 --authorized
```

`--authorized` 对应网页的授权勾选。候选与结果只在当前进程中处理，匹配密码输出到终端；不会自动保存真实字典或结果。重定向输出时自行保存在私有位置。

## 并行与控制

`--workers` 可设 1–256，默认取可用逻辑核数。启动器在新进程启动前正确设置 `UV_THREADPOOL_SIZE`，计算使用 Node 原生 `crypto.pbkdf2` 与原生 HMAC，实际线程由 libuv 管理，不是用 JS 重写 PBKDF2。

终端每秒显示候选数、速度、进度、并行数。TTY 下输入以下命令并按 Enter：

- `p`：暂停/继续。
- `s`：停止计算，保留当前进程的内存断点。
- `r` 或 `start`：从相同候选源的断点继续。
- `q` 或 Ctrl+C：退出。退出进程后断点消失。

程序会在当前候选边界回收任务。同一字典正常停止/继续不漏项、不重复已确认候选；异常无响应时仅保留已确认进度，未确认尾部可能重试。完成或匹配后退出。

`--json` 输出 NDJSON（会话、进度、结果），`--interactive` 允许通过管道传入控制命令。退出码：0=匹配/列出会话；1=完整运行无匹配；2=输入/运行错误；130=用户中断。

## 正则支持范围

按整个候选生成，`^`/`$` 可选；支持可打印 ASCII 字面量、`.`、`[0-9]`/`[a-z]`/否定集合、`\d`/`\w`/`\s`、分组、`(?:...)`、分支 `|`、`?`、`{n}`、`{m,n}`。只生成 8–63 字节密码，`\s` 在可打印 ASCII 中仅为空格。

无界 `*`/`+`、前后查找、反向引用、flags 等不支持，明确报错。重复上限 63，表达式上限 512 字符；结构/候选数量超限时拒绝运行。重叠分支可能产生重复单词，统计的是枚举位置。示例：

- `^[0-9]{8}$`：100,000,000 个。
- `^test[0-9]{4}$`：10,000 个。
- `^(19|20)[0-9]{6}$`：2,000,000 个（这条不是日期校验，需有效生日时使用 birthday 来源）。

PCAP/算法支持范围与独立 HTML 相同：WPA2-PSK、CCMP、描述符版本 2，拒绝冲突和缺失材料。M1+M2 的匹配可能只是终端尝试的密码，不单独证明 AP 接受该密码。

## 测试

```sh
node tests/node-cli.cjs
node tests/cli-interactive.cjs
node tests/pool-checkpoint.cjs
```

全部使用合成握手与密码，不提交真实抓包。CLI 与两个网页共享候选源、有限正则生成器、任务调度器和暂停/断点逻辑。
