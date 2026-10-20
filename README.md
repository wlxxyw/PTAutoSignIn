# 自动签到浏览器容器方案

基于 Alpine + VNC + Chromium + CDP (Chrome DevTools Protocol) 的自动签到解决方案。

## 项目优势

- **零驱动、零框架依赖**：无需安装 WebDriver/chromedriver，也无需下载 Playwright/Selenium 自带的浏览器二进制，彻底告别"驱动版本与浏览器不匹配"的折腾。调度程序直接通过原生 CDP 协议控制浏览器，Node 侧仅依赖 axios、ws、js-yaml 三个包，全链路 Docker 化，一条命令部署。
- **真实浏览器、多标签并发**：运行带图形界面的完整 Chromium（非无头模式），天然具备真实浏览器指纹，有效绕过 Cloudflare 等风控；每个站点独占一个标签页，上下文隔离，多站点并发执行互不干扰；浏览器、任务调度、验证码 OCR 拆分为独立容器，进程职责清晰、故障隔离。
- **配置零密码**：`config.yaml` 只描述"访问哪个页面、执行什么操作"，不存放任何账号、密码或密钥；登录凭证（cookie/session）保存在持久化浏览器 Profile 中，仅需首次通过 VNC 人工登录，之后长期复用，凭证与流程配置彻底分离。
- **可安装浏览器扩展**：有界面的完整 Chromium 支持通过 VNC 安装扩展（如 Cookie-Cloud 同步Cookie插件，SmartProxy 控制某些站点使用代理等) 。
- **可定制通知模块**：内置 Gotify 与企业微信群机器人双通道，浏览器启动失败、站点过期、签到失败等关键事件自动推送；通知逻辑收敛在 `sendNotification()` 一个函数内，扩展 Bark/Telegram/邮件等渠道只需加一段类似的 POST。
- **多层自动重试 + 人工兜底**：动作级（goto/CDP 传输错误指数退避重试 3 次）、站点级（失败自动关闭标签页，下轮重跑完整流程）、调度级（crontab 周期触发）三层兜底；自动化搞不定时保留标签页等 VNC 人工处理，处理完自动标记成功。
- **验证码应对方案齐全**：图片验证码走容器内置 ddddocr 本地识别；altcha / Cloudflare Turnstile 等人机验证可用纯 JS + CDP 模拟拟人鼠标轨迹尝试绕过；仍不行则 VNC 人工接管。

## 已知局限

- **配置门槛偏高**：签到流程由 YAML 动作序列 + 页面内原生 JavaScript 共同描述，处理多步交互、人机验证等复杂站点需要一定的 JS/前端调试能力。推荐将 [docs/AI_CONFIG_GUIDE.md](docs/AI_CONFIG_GUIDE.md) 连同站点信息一起交给 AI，即可自动生成可用配置（该文档专为此场景编写）。
- **首次需人工登录**：新站点或凭证过期时，需要先通过 VNC 手工登录一次（这正是"配置不存密码"的另一面）；也可安装 Cookie 同步类扩展减少手工操作。
- **人机验证无法保证 100% 成功**：鼠标轨迹等绕过方案受站点前端更新影响，此类站点建议开启 `retry: true` 并依赖失败通知兜底。
- **单浏览器实例**：并发在同一 Chromium 实例的多个标签页间进行（并发数由 `MAX_CONCURRENT_SITES` 控制），暂不支持多浏览器实例水平扩展。

## 技术架构

```
┌────────────────────┐
│   manager 容器     │
│                    │
│  CDP 脚本调度      │
│  任务管理引擎      │
└─────────┬──────────┘
          │ WebSocket/9222
          │
┌─────────▼──────────┐
│  chromium-vnc 容器 │
│                    │
│  Alpine Linux      │
│  Chromium Browser  │
│  Fluxbox (窗口管理)│
│  x0vncserver (VNC) │
│  Xvfb (虚拟显示)   │
│  supervisord (进程管理)│
│                    │
│  持久化 Profile    │
└────────────────────┘

┌────────────────────┐
│    ocr 容器        │
│  ddddocr 验证码识别│
│  (Flask HTTP 服务) │
└────────────────────┘
```

## 技术栈

| 组件 | 技术 | 版本 |
|------|------|------|
| 操作系统 | Alpine Linux | 3.23 |
| 浏览器 | Chromium | latest |
| 容器平台 | Docker | latest |
| 开发语言 | Node.js | 22 |
| 通信协议 | CDP (Chrome DevTools Protocol) | - |
| 远程控制 | VNC (x0vncserver) | - |
| 配置格式 | YAML | - |

## 项目结构

```
.
├── docker-compose.yml         # Docker Compose 配置
├── README.md                  # 项目说明文档
├── docs/
│   └── AI_CONFIG_GUIDE.md     # 配置编写指南（可直接交给 AI 生成配置）
├── chromium-vnc/              # Chromium 浏览器容器
│   ├── Dockerfile             # 浏览器容器构建配置
│   ├── supervisord.conf       # 进程管理配置
│   ├── start_chromium.sh      # 浏览器 启动脚本
│   └── start_vnc.sh           # VNC 启动脚本
├── crontab/                   # 定时任务容器
│   ├── Dockerfile             # 定时任务容器构建配置
│   ├── crontab.default        # 定时任务配置示例
│   └── start.sh               # 容器启动脚本
├── ddddocr/                   # 验证码 OCR 容器
│   ├── Dockerfile
│   └── src/server.py          # Flask + ddddocr 识别服务
└── config/                    # docker-compose 挂载的文件
    ├── fluxbox-menu           # fluxbox 的右键菜单配置， 增加 浏览器 的启动
    ├── crontab                # 定时任务定义
    ├── init.d/                # 定时任务容器初始化脚本 详见crontab/start.sh 内逻辑
    │   └── 01_INIT_ENV.sh     # 安装软件， 初始化 /app 目录下nodejs项目依赖
    └── app/                   # nodejs 脚本
        ├── package.json       # 依赖配置
        ├── package-lock.json  # 依赖锁配置文件
        ├── main.js            # 主入口文件
        ├── browserManager.js  # CDP 浏览器通信模块
        ├── actionExecutor.js  # 操作执行引擎
        ├── siteFilter.js      # 站点筛选逻辑
        ├── utils.js           # 工具函数
        ├── config.example.yaml# 配置示例（含多种站点实战模板）
        └── config.yaml        # 实际运行配置（由 config.example.yaml 复制而来）
```

## NodeJS项目 核心模块说明

### 1. BrowserManager

负责管理 CDP 连接和标签页：
- 维护多个标签页的 WebSocket 连接
- 支持连接复用和生命周期管理
- 自动检测并关闭空闲浏览器

### 2. ActionExecutor

执行签到操作引擎：
- 支持 9 种操作类型：goto、action、wait、cwait、check、ccheck、switch、loop、cdp
- 脚本在页面上下文中以原生 JavaScript（支持 async/await）执行
- 支持 `$ctx` 上下文：action 返回的对象会合并进 `$ctx`，供后续脚本与 cdp 的 `{{}}` 占位符引用
- wait/cwait 超时控制（默认 180 秒，`OPERATION_TIMEOUT`）
- goto/CDP 传输错误 3 次重试（指数退避）

### 3. SiteFilter

站点筛选逻辑：
- 过滤已暂停的站点
- 过滤已过期的站点
- 过滤今日已成功签到的站点

## 配置文件说明

> 完整的字段语义、9 种操作类型详解、编写模板与 AI 提示词见 **[docs/AI_CONFIG_GUIDE.md](docs/AI_CONFIG_GUIDE.md)**。

### 配置文件格式

复制 `config/app/config.example.yaml` 为 `config/app/config.yaml` 并修改配置：

```yaml
- domain: "example.org"            # 站点域名（仅主机名，用于标签页匹配）
  date: ""                         # 上次执行日期(M/D/YYYY 如 10/16/2026)，新站点留空即可执行
  status: 0                        # 连续失败次数 (0=成功)
  pause: false                     # 暂停此任务
  retry: true                      # 失败后是否自动重试(详见下方字段说明)
  actions:
    - goto: "https://example.org/attendance.php"  # 导航到指定 URL
    - wait: ".head"                                 # 等待指定元素出现(CSS 选择器)
    - action: |                                     # 执行原生 JavaScript
        const btn = document.querySelector('#sign-btn');
        if (btn) btn.click();
    - action: await new Promise(resolve => setTimeout(resolve, 5000)); # 等待点击事件生效 
    - ccheck: |                                     # 自定义检查，返回 false 则站点失败
        const h2 = document.querySelector('h2');
        return !!h2 && h2.textContent.includes('签到成功');
```

### 配置字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| domain | string | 是 | 站点域名（仅主机名；用于标签页匹配，同时作为初始标签页地址 `https://<domain>`） |
| date | string | 是 | 最后执行日期（容器内 `toLocaleDateString()` 格式，如 `10/16/2026`；新站点留空 `""`）。当天且 status==0 时跳过 |
| status | number | 是 | 签到状态 (0=成功, >0=连续失败次数，自动维护) |
| pause | boolean | 是 | 是否暂停签到（站点过期时自动置 true） |
| retry | boolean | 否 | 是否重试失败任务：<br/>`true` 失败后关闭标签页，下次执行重新进行完整流程<br/>`false` 失败后保留标签页，等待人工 VNC 处理；人工关闭该标签页后，下次执行自动将该站点标记为成功 |
| expireDate | string | 否 | 过期日期（与 date 同格式），到期自动 pause 并发送通知 |
| lastFailNotifyDate | string | 否 | 上次失败通知日期（自动维护，防止重复通知，无需手写） |
| actions | array | 是 | 签到操作列表 |

### 操作类型说明

每个 action 是只含一个键的对象，按数组顺序执行。

| 类型 | 说明 | 失败行为 |
|------|------|----------|
| `goto` | 导航到指定 URL（不等待页面加载完成，之后必须用 wait/cwait 等待） | 导航报错自动重试 3 次（指数退避） |
| `action` | 执行原生 JavaScript。返回对象会合并进 `$ctx` | 不返回(undefined)或返回对象=成功；返回 false/抛异常=站点失败 |
| `wait` | 轮询等待 CSS 选择器命中元素（默认间隔 2s，超时 180s） | 超时则站点失败 |
| `cwait` | 轮询执行自定义 JS，返回 true 通过（支持 await） | 超时则站点失败 |
| `check` | 检查 CSS 选择器元素是否存在（单次判定） | 不存在则站点失败 |
| `ccheck` | 执行自定义 JS，返回 false 则站点失败（单次判定，用于最终校验"签到成功"等） | 返回 false/抛异常=站点失败 |
| `switch` | 条件分支：按序检查各 case 的 check/ccheck，命中第一个执行其 actions 后结束 | 全部不命中则直接通过（相当于可选分支） |
| `loop` | 循环：`times: N` 定次循环，或 check/ccheck 条件循环（条件为 true 继续，上限 100 次） | 循环内 action 失败则站点失败 |
| `cdp` | 直接下发原生 CDP 命令（如 `Input.dispatchMouseEvent` 模拟鼠标），params 支持 `{{key}}` 引用 `$ctx` | CDP 报错自动重试 3 次 |

> 注意：页面脚本异常（语法错误、选择器不存在等）不会单独报错，而是被当作"返回 false"处理，`wait/cwait` 会继续轮询直到超时，`check/ccheck/action` 直接判定失败。排错时请优先检查脚本本身。

### $ctx 上下文与 {{}} 占位符

- 任何 `action` 返回的非数组对象会合并（浅合并，同名覆盖）进 `$ctx`
- 后续 `action`/`wait`/`cwait`/`check`/`ccheck` 脚本内可直接读取 `$ctx.xxx`
- `cdp` 的 params 支持 `{{xxx}}` / `{{xxx.yyy}}` 引用，整串占位符保留原始类型（数字不会变字符串）

```yaml
- action: |
    const rect = document.querySelector('.checkbox').getBoundingClientRect();
    return { target: { x: rect.left + 10, y: rect.top + 10 } };
- cdp:
    method: Input.dispatchMouseEvent
    params:
      type: mousePressed
      x: '{{target.x}}'
      'y': '{{target.y}}'
      button: left
      clickCount: 1
```

### switch / loop 示例

```yaml
# 条件分支：存在验证码才处理，已签到则跳过
- switch:
    - check: .captcha-widget
      actions:
        - wait: .captcha-checkbox
        - action: |
            document.querySelector('.captcha-checkbox').click();
    - ccheck: |
        return document.body.textContent.includes('已签到');
      actions: []

# 定次循环：喊话 3 次
- loop:
    times: 3
    actions:
      - action: |
          document.querySelector('#shout-input').value = "hello";
          document.querySelector('#shout-submit').click();
      - action: await new Promise(r => setTimeout(r, 5000));

# 条件循环：轨迹点未消费完则继续（返回 true 继续循环）
- loop:
    ccheck: return !!$ctx.path0;
    actions:
      - cdp:
          method: Input.dispatchMouseEvent
          params:
            type: mouseMoved
            x: '{{path0.x}}'
            'y': '{{path0.y}}'
      - action: |
          const path = $ctx.path.slice(1);
          return { path, path0: path[0] || null };
```

### 操作示例

```yaml
# 导航到页面（之后必须等待）
- goto: "https://example.com/attendance.php"

# 等待选择器出现（CSS 选择器）
- wait: "#login-btn"

# 执行点击操作（原生 JS，无 jQuery）
- action: |
    const btn = document.querySelector('#login-btn');
    if (btn) btn.click();

# 固定等待
- action: await new Promise(r => setTimeout(r, 3000));

# 等待条件满足（自定义 JS，返回 true 通过）
- cwait: |
    return !document.querySelector('.captcha');

# 检查元素是否存在（不存在则站点失败）
- check: ".success-message"

# 自定义检查（返回 false 则站点失败）
- ccheck: |
    return document.body.textContent.includes('签到成功');

# 页面内直接调用站点自身 API（自动携带登录态）
- ccheck: |
    const res = await fetch('/api/check-in', { method: 'POST' });
    return res.status === 200;
```

### CDP 方法说明

`cdp` 是高级功能，内部使用的常见 CDP 方法：
- `Page.navigate` - 导航到指定 URL（即 goto 的实现）
- `Runtime.evaluate` - 执行 JavaScript 代码（即 action/wait/check 等的实现）
- `Input.dispatchMouseEvent` - 模拟鼠标移动/按下/抬起（人机验证轨迹模拟）
- `Input.dispatchKeyEvent` - 模拟键盘输入

完整方法列表见 [Chrome DevTools Protocol 文档](https://chromedevtools.github.io/devtools-protocol/)。

## 环境变量

### 通用(双方通讯,除非调试否则不应该暴露到容器外)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| SUPERVISOR_WEB_USERNAME | admin | supervisord 用户名 |
| SUPERVISOR_WEB_PASSWORD | admin | supervisord 密码 |
| SUPERVISOR_WEB_PORT | 9001 | supervisord 管理界面端口 |
| BROWSER_PORT | 9222 | CDP 端口 |

### chromium-vnc 容器

| 变量 | 默认值 | 说明 |
|------|--------|------|
| DISPLAY | :99 | 虚拟显示编号 |
| SCREEN_WIDTH | 1366 | 屏幕宽度 |
| SCREEN_HEIGHT | 768 | 屏幕高度 |
| SCREEN_DEPTH | 16 | 颜色深度 |
| VNC_PASS | superpass123! | VNC 密码,用于远程控制浏览器（务必修改） |

### manager 容器

| 变量 | 默认值 | 说明 |
|------|--------|------|
| WAIT_CHECK_INTERVAL | 2000 | 检查间隔(毫秒) |
| OPERATION_TIMEOUT | 180000 | 操作超时(毫秒)，作用于 wait/cwait |
| MAX_CONCURRENT_SITES | 3 | 最大并发站点数(此数值越高，chromium-vnc容器资源占用也越高) |
| GOTIFY_MSG_API | - | Gotify 通知接口 URL（POST `{title,message,priority}`），未设置则不启用 |
| QIYEWEIXIN_MSG_API | - | 企业微信群机器人 Webhook URL（POST `{msgtype:'text',text:{content}}`），未设置则不启用 |

通知触发时机：①浏览器启动失败 ②存在站点过期 ③站点签到失败且当前时间已过 12 点、当日未通知过。

## 快速开始

### 1. 配置站点

复制并编辑示例配置：

```bash
cp config/app/config.example.yaml config/app/config.yaml
# 编辑 config.yaml 添加签到站点配置（可交给 AI 生成，见 docs/AI_CONFIG_GUIDE.md）
```

### 2. 启动容器

```bash
docker-compose up -d
```

### 3. VNC 连接（站点认证）

仅首次使用或站点认证信息过期时需要：

使用 VNC 客户端连接到 `localhost:5900`，密码为 `superpass123!`（docker-compose.yml 中的 `VNC_PASS`），打开浏览器访问站点进行认证操作。
认证信息（cookie/session 等）会保留在 chromium-vnc 容器挂载的 `./config/chromium-data`（容器内 `/root/.config/chromium`）下。

### 4. 触发签到任务

```bash
docker exec -it manager sh -c "cd /app && node ./main.js"
```

### 5. 定时任务配置

```cron
# 已内置容器内定时任务，无需从主机发起调用
# 直接修改 config/crontab（挂载为容器内 /etc/crontab.default），supercronic inotify 热加载，改完即生效
*/30 3-23 * * * cd /app && node ./main.js
```

### 6. 查看日志

```bash
# 查看调度容器日志
docker-compose logs -f manager
# 或者查看配置文件 的date/status值
cat config/app/config.yaml
```

### 7. VNC 连接（人工处理）

使用 VNC 客户端连接到 `localhost:5900`，密码为 `superpass123!`：
- 若浏览器未运行，则无需操作。所有任务正常完成后会自动关闭浏览器，降低资源占用。
- 若浏览器已运行，则操作对应界面，操作完成后关闭相应标签页（或关闭浏览器），下一次执行会自动将该站点标为成功状态。

## 业务流程

```
1. 读取配置文件 (config.yaml)
    ↓
2. 筛选待签到站点
   ├─ expireDate 已过期 (自动将 pause 设为 true)
   ├─ pause=false (仅操作未暂停的站点)
   └─  date≠今天 或 status≠0 (今天未执行的站点会进行操作/今天执行出错的站点会再次进行操作)
    ↓
3. 检测浏览器状态
   ├─ 已运行 → 直接连接
   └─ 未运行 → 通过 supervisord 启动
    ↓
4. 检查是否有遗留标签页
   ├─ 存在 → 跳过（等待人工处理）
   ├─ 不存在 && status==0 → 新建标签页开始处理
   ├─ 不存在 && status!=0 && retry=true → 新建标签页开始处理（重试）
   └─ 不存在 && status!=0 && retry=false → 直接标记为成功（认为已经过人工处理）
    ↓
5. 执行签到操作序列
   ├─ goto: 导航到页面
   ├─ wait/cwait: 等待元素/条件就绪
   ├─ action: 执行操作（可写回 $ctx）
   ├─ switch/loop: 条件分支与循环
   ├─ cdp: 模拟鼠标/键盘等原生操作
   └─ check/ccheck: 验证结果
    ↓
6. 更新站点状态，date=今天
   ├─ 成功 → 关闭标签页, status=0
   ├─ 失败 & retry=true → 关闭标签页, status++
   └─ 失败 & retry=false → 保留标签页, status++
    ↓
8. 检查是否需要关闭浏览器
   └─ 浏览器是本次启动的且所有筛选后的站点都已完成 → 关闭浏览器
```

## 安全注意事项

1. **密码管理**：请修改默认 VNC 密码（VNC_PASS），supervisord 认证信息仅用于容器间通讯。
2. **端口暴露**：非调试情况下请勿暴露 9001 和 9222 端口。
3. **配置文件**：`./config/chromium-data` 包含浏览器认证信息，建议限制权限；`config.yaml` 本身不应包含账号密码（登录态保存在浏览器 Profile 中）。
4. **验证码处理**：遇到失败时保留标签页，等待人工处理。
5. **页面脚本**：所有 action 脚本在页面上下文执行，注意不要在配置中硬编码敏感信息。

## 故障排除

### 浏览器无法启动

检查 chromium-vnc 容器日志：
```bash
docker-compose logs chromium-vnc
```

### 签到失败

检查 manager 容器日志：
```bash
docker-compose logs manager
```

脚本类失败（wait 超时、ccheck 返回 false）通常是脚本异常被当作 false 处理，优先检查选择器是否匹配、脚本有无运行时错误。

### VNC 连接失败

确保端口未被占用：
```bash
netstat -tlnp | grep 5900
```

## 贡献

欢迎提交 Issue 和 Pull Request！
