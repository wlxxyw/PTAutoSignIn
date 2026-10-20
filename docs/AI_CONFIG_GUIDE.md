# 配置编写指南（可直接交给 AI 生成 config.yaml）

本文档完整描述 AutoLoginSignIn 的配置格式与执行语义，专为「把站点信息交给 AI，由 AI 生成签到配置」的场景编写。

**使用方法**：将本文档全文 + actionExecutor.js + 目标站点的信息（签到页 URL、人工签到的操作步骤、关键元素的 HTML 片段或选择器）发给 AI，让 AI 直接产出可追加到 `config/app/config.yaml` 的站点条目。

> 仓库内 `config/app/config.example.yaml` 收录了十余个真实站点的实战配置（含图片验证码、altcha、Cloudflare Turnstile 等高难度场景），可作为范例一并提供给 AI。

---

## 1. 配置文件总览

- 文件路径：宿主机 `config/app/config.yaml`（容器内 `/app/config.yaml`；首次使用复制 `config.example.yaml` 为 `config.yaml`）
- 顶层结构：**YAML 数组**，每个元素代表一个站点的完整签到流程
- 调度器按 crontab 周期执行：筛选出「今天未成功」的站点，逐个打开标签页按顺序执行 `actions`
- 程序每次执行后会自动回写本文件（更新 `date`、`status`、`lastFailNotifyDate`、`pause` 等字段）

```yaml
- domain: example.org
  date: ""
  status: 0
  pause: false
  retry: true
  actions:
    - goto: https://example.org/attendance.php
    - wait: .head
    - ccheck: |
        const h2 = document.querySelector('h2');
        return !!h2 && h2.textContent.includes('签到成功');
```

> 注意：YAML 层面的 `#` 注释会在首次执行后被丢弃（`yaml.dump` 重写整个文件）；写在 `action`/`ccheck` 等脚本字符串内部的 `//` JS 注释会保留。重要说明建议写成 JS 注释。

## 2. 站点字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| domain | string | 是 | 站点主机名（如 `example.org`，**不要**带 `https://` 或路径）。开标签页时访问 `https://<domain>`；同时用于匹配浏览器中已存在的标签页（URL **子串匹配**），防止重复开页 |
| date | string | 是 | 上次执行日期，容器内 `toLocaleDateString()` 格式 `M/D/YYYY`（如 `10/16/2026`）。**新站点填 `""`（空字符串）**即可立即执行；程序执行后自动更新 |
| status | number | 是 | `0` 表示成功；正数表示连续失败次数。程序自动维护，新站点填 `0` |
| pause | boolean | 是 | `true` 跳过该站点。站点过期时程序会自动置为 `true` |
| retry | boolean | 否 | 失败后的策略，见 §2.1 |
| expireDate | string | 否 | 过期日期，到期自动 `pause: true` 并发送通知。⚠️ 当前实现是与 `date` 相同格式的**字符串比较**，月份位数不同时存在比较缺陷（如 `9/x` 与 `10/x`），谨慎依赖 |
| lastFailNotifyDate | string | 否 | 上次发送失败通知的日期，程序自动维护，**无需手写** |
| actions | array | 是 | 签到操作序列，见 §3 |

### 2.1 retry 语义（重要）

- `retry: true`：流程失败 → **关闭标签页** → 下一轮调度重新执行完整流程。适合可全自动重试的站点；含验证码/人机验证的站点建议开启。
- `retry: false`（或省略）：流程失败 → **保留标签页**，等待人工通过 VNC 处理。人工处理完成后**关闭该标签页**，下一轮运行时程序发现「当天失败过 + 无残留标签页」，会自动将该站点标记为成功。
- 补充：只要浏览器中存在 URL 包含 `domain` 的标签页，该站点在该轮都会被跳过并按失败计（这正是「保留标签页等人工作业」机制的实现方式）。

### 2.2 执行/跳过判定

站点在一轮调度中被执行，当且仅当全部满足：

1. `pause` 不为 true
2. 未超过 `expireDate`
3. `date` 不等于今天，或 `status != 0`

即：**今天已成功（date=今天 且 status=0）的站点当天不再执行**。

## 3. 动作（action）类型

`actions` 数组的每个元素都是 `{ <类型>: <数据> }` 形式的**单键对象**，按数组顺序执行，共 9 种类型。

### 3.1 执行环境（所有 JS 脚本通用）

- 脚本运行在**目标页面自身的上下文**中，等价于在 DevTools Console 里执行；可直接 `fetch(...)` 调用站点自身 API（自动携带登录态/Cookie）
- 使用**原生 JavaScript + DOM API**，**没有 jQuery**（不要写 `$()`, 除非该站点自己引入了jQuery）
- 脚本被包装为 async 函数执行，可以直接使用 `await`（如 `await new Promise(r => setTimeout(r, 3000))`）
- 可用上下文对象 `$ctx`：由之前 `action` 返回的对象合并而成（见 §4）
- **脚本抛出异常不会单独报错**，而是被当作「返回 false」处理：`wait/cwait` 继续轮询直到超时，`check/ccheck/action` 判定失败。**务必保证脚本本身没有语法/运行时错误**，否则排错会表现为莫名超时

### 3.2 类型一览

| 类型 | 数据 | 语义 | 失败/超时行为 |
|------|------|------|---------------|
| goto | URL 字符串 | 导航到指定页面。**不等待页面加载完成**，之后必须用 wait/cwait 等待 | 导航报错自动重试 3 次（指数退避），仍失败则站点失败 |
| wait | CSS 选择器 | 轮询直到选择器命中元素（默认间隔 2s，超时 180s） | 超时则站点失败 |
| cwait | JS 脚本 | 轮询直到脚本 `return true` | 同 wait；返回 false/抛异常都视为「还没就绪」 |
| check | CSS 选择器 | 检查元素是否存在（单次判定） | 不存在则站点失败 |
| ccheck | JS 脚本 | `return true` 通过；`return false` 站点失败（单次判定，常用于最终校验） | 返回 false/抛异常则站点失败 |
| action | JS 脚本 | 执行任意操作（点击、填表、延时等） | 不返回(undefined)或返回对象=成功；返回 false/抛异常=站点失败 |
| switch | case 数组 | 条件分支（if/else-if 链），见 §3.4 | case 内 action 失败则站点失败 |
| loop | 对象 | 循环，见 §3.5 | 循环内 action 失败则站点失败 |
| cdp | `{method, params}` | 直接下发原生 CDP 命令（高级），见 §3.6 | CDP 报错自动重试 3 次 |

> 「重试 3 次」仅针对导航/CDP 传输层错误（间隔 2s、4s 指数退避）；**页面内 JS 脚本异常不重试**，直接按 false 处理。与站点级 `retry`（下一轮重跑）是两层不同机制。

### 3.3 基础示例

```yaml
actions:
  - goto: https://example.org/attendance.php  # 打开签到页
  - wait: .head                                # 等待页面骨架出现
  - action: |                                  # 点击签到按钮（原生 JS）
      const btn = document.querySelector('#sign-btn');
      if (btn) btn.click();
  - action: await new Promise(r => setTimeout(r, 3000));  # 固定等待 3 秒
  - ccheck: |                                  # 最终判定：必须显式 return 布尔值
      const h2 = document.querySelector('h2');
      return !!h2 && h2.textContent.includes('签到成功');
```

### 3.4 switch 条件分支

```yaml
- switch:
    - check: .captcha-img            # case 1：存在图片验证码
      actions:
        - action: |
            /* 处理验证码的动作... */
    - ccheck: |                      # case 2：自定义条件
        return !!document.querySelector('.already-signed');
      actions: []                    # 已签到 → 什么都不用做
```

语义：

- 从上到下依次检查每个 case 的 `check`/`ccheck`，**命中第一个就执行其 `actions`，随后整个 switch 结束**（后续 case 不再检查）
- 所有 case 都不命中 → switch 直接视为成功，继续下一步（相当于「可选分支」，不会失败）
- case 内的 action 若失败，整个站点失败；`actions: []` 表示命中后跳过即可

### 3.5 loop 循环

两种模式（二选一）：

```yaml
# 模式一：固定次数
- loop:
    times: 3
    actions:
      - action: |
          /* 重复执行 3 次 */

# 模式二：条件循环（前测：check/ccheck 返回 true 则继续循环，false 结束）,循环次数不会超过maxTimes(默认100)
- loop:
    ccheck: return !!$ctx.path0;
    maxTimes: 100;
    actions:
      - action: |
          /* 每轮可更新 $ctx，直至条件不再满足 */
```

- 循环内任何 action 失败 → 整个站点失败

### 3.6 cdp 高级指令

直接调用任意 [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) 方法，常用于模拟鼠标轨迹绕过人机验证：

```yaml
- cdp:
    method: Input.dispatchMouseEvent
    params:
      type: mouseMoved
      x: '{{point.x}}'    # 从 $ctx 取值；整串占位符保留数字类型
      'y': '{{point.y}}'  # y 建议加引号（YAML 中裸值也可，保持一致性）
```

- `params` 中支持 `{{路径}}` 占位符，从 `$ctx` 按 `.` 取值；混在字符串中时按字符串拼接
- 常用方法：`Input.dispatchMouseEvent`（鼠标）、`Input.dispatchKeyEvent`（键盘）、`Page.navigate` 等

## 4. $ctx 上下文机制

- 每个站点开始执行时 `$ctx` 为空对象 `{}`
- `action` 返回**非数组对象**时，会与 `$ctx` 浅合并（同名覆盖）
- 后续 `action`/`cwait`/`ccheck` 脚本内可直接读取 `$ctx.xxx`；`cdp` 的 params 用 `{{xxx}}` 引用
- 典型用法（配合 cdp 模拟轨迹）：`action` 生成轨迹数组写入 `$ctx` → `loop` + `cdp` 逐点消费（完整示例见 `config.example.yaml` 中 yemapt.org / xloli.cc 站点）

## 5. 常用模式模板

### 5.1 保活（无签到，仅访问页面）

```yaml
- domain: keep.example.org
  date: ""
  status: 0
  pause: false
  retry: false
  actions:
    - goto: https://keep.example.org/torrents.php
    - wait: .head
    - check: body
```

### 5.2 简单签到（NexusPHP 类 PT 站）

```yaml
- domain: pt.example.org
  date: ""
  status: 0
  pause: false
  retry: true
  actions:
    - goto: https://pt.example.org/attendance.php
    - wait: .head
    - ccheck: |
        const h2 = document.querySelector('h2');
        return !!h2 && (h2.textContent.includes('签到成功') || h2.textContent.includes('已签到'));
```

### 5.3 点击签到按钮 + 区分「已签到」分支

```yaml
- domain: sign.example.org
  date: ""
  status: 0
  pause: false
  retry: true
  actions:
    - goto: https://sign.example.org/attendance.php
    - wait: body
    - switch:
        - ccheck: |
            // 已签到，什么都不用做
            const t = document.body.textContent;
            return t.includes('签到成功') || t.includes('已签到');
          actions: []
        - ccheck: |
            // 额外需要点击一次按钮
            const btn = Array.from(document.querySelectorAll('button, a, input[type=submit]'))
              .find(el => (el.textContent || el.value || '').includes('签到'));
            if (!btn) return false;
            btn.click();
            return true;
          actions:
            - action: await new Promise(r => setTimeout(r, 3000));
    - ccheck: |
        return document.body.textContent.includes('签到成功')
            || document.body.textContent.includes('已签到');
```

### 5.4 图片验证码（调用容器内置 ddddocr，可自行安装更好的OCR服务或者调用外部服务）

容器内 OCR 服务地址 `http://127.0.0.1:8000/ocr`（页面内直接 fetch 即可）：

- 请求：POST JSON，`{ "image": "<去掉 data:image/*;base64, 前缀的纯 base64>" }`
- 响应：`{ "result": "识别文本" }`

图片需先用 Canvas 转 base64，并等待 `img.complete`。完整可运行示例见 `config.example.yaml` 中 `www.oshen.win` 站点。OCR 不保证 100% 准确，**务必 `retry: true`**。

### 5.5 页面内直接调用站点 API

```yaml
- ccheck: |
    const res = await fetch('/api/check-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check-in' })
    });
    return res.status === 200;
```

页面上下文中的 fetch 自动携带该站点 Cookie，适合有复杂UI操作的站点。

## 6. 编写规则清单（AI 必读）

1. **绝对不要**在配置中出现账号、密码、API Token 等凭证——登录态依赖浏览器 Profile 中已有的 Cookie（首次需人工 VNC 登录）
2. 新站点 `date` 一律写 `""`；不要手写今天的日期，否则当天会被跳过
3. `domain` 只写主机名（`example.org`），不带协议和路径
4. 页面加载后必须先 `wait`/`cwait` 等元素可用，再执行点击/填表；异步操作后适当 `await` 延时
5. `ccheck`/`cwait` 必须显式 `return` 布尔值；忘记 return 得到 undefined → 永远 false → 超时/失败
6. 脚本一律用原生 JS（`document.querySelector` 等），禁止 jQuery 写法；`querySelector` 不支持 `:contains` 之类的非标准选择器，文本匹配请在 JS 里用 `textContent`
7. 脚本异常 = false 且**不重试**：生成后自查括号/引号/可选链，避免 `undefined.xxx` 类错误
8. 判定类步骤（签到是否成功）用 `ccheck`（失败即站点失败）；单纯等待用 `wait`/`cwait`
9. 把「已签到也算成功」考虑进判定逻辑，避免重复点击引发风控
10. 含验证码/人机验证的站点设 `retry: true`，并用 `switch` 实现「无验证码直接过 / 有验证码走处理分支」
11. 值中含 `#`（YAML 注释符）、`:` 等特殊字符的选择器/字符串必须用引号包裹（如 `- wait: '#nav_block'`）
12. 多行脚本使用 `|` 或 `|-` 块标量；注意 YAML 缩进
13. 生成的配置追加到 `config.yaml` 数组末尾即可，不要手写修改程序维护的运行字段（date/status/lastFailNotifyDate）
14. 复用 `config.example.yaml` 中已验证的模式，不要发明新的 action 类型
15. 配置完成后可手动触发验证：`docker exec -it manager sh -c "cd /app && node ./main.js"`，并在 `config.yaml` 中观察 `status` 变化

## 7. 环境参数速查

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| OPERATION_TIMEOUT | 180000 | wait/cwait 最长等待（毫秒） |
| WAIT_CHECK_INTERVAL | 2000 | 轮询间隔（毫秒） |
| MAX_CONCURRENT_SITES | 3 | 同时并发处理的站点数 |
| GOTIFY_MSG_API | - | Gotify 通知接口 URL（POST `{title,message,priority}`） |
| QIYEWEIXIN_MSG_API | - | 企业微信群机器人 Webhook（POST `{msgtype:'text',text:{content}}`） |

失败通知触发条件：站点失败、当前时间 ≥ 12:00、且当天未通知过（由 `lastFailNotifyDate` 去重）。

## 8. 提示词模板（用户直接复制使用）

```text
请阅读附带的《配置编写指南（AutoLoginSignIn）》，为以下站点生成 config.yaml 中的一个数组条目。
只输出可直接粘贴的 YAML，不要多余解释：

- 站点域名：pt.example.org
- 签到页：https://pt.example.org/attendance.php
- 人工签到步骤：打开签到页 → 页面出现「签到成功」字样即完成
- 页面关键元素：h2 标题 class="head"
- 其他注意：无验证码
```

若 AI 无法直接看到页面，尽量多提供：签到按钮的 HTML 片段、成功/失败的文字提示、是否已有 iframe/验证码、失败时页面的表现等。
