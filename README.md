# 自动签到浏览器容器方案

基于 Alpine + VNC + Chromium + CDP (Chrome DevTools Protocol) 的自动签到解决方案。

## 功能特性

- ✅ 使用真实 Chromium 浏览器，有效绕过 Cloudflare 风控
- ✅ 浏览器运行于独立 Docker 容器
- ✅ 支持 VNC 人工接管处理验证码
- ✅ 浏览器 Profile 持久化存储
- ✅ Node.js 容器负责调度签到任务
- ✅ 每个站点使用独立标签页
- ✅ 遇到验证码时暂停等待人工处理
- ✅ 完成后自动关闭标签页
- ✅ 支持多站点并发执行
- ✅ 智能浏览器生命周期管理

## 技术架构

```
┌────────────────────┐
│   Node.js 容器     │
│                    │
│  CDP 脚本调度      │
│  任务管理引擎      │
└─────────┬──────────┘
          │ WebSocket/9222
          │
┌─────────▼──────────┐
│  Chromium 容器     │
│                    │
│  Alpine Linux      │
│  Chromium Browser  │
│  Fluxbox (窗口管理)│
│  x11vnc (VNC服务)  │
│  Xvfb (虚拟显示)   │
│  supervisord (进程管理)│
│                    │
│  持久化 Profile    │
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
| 远程控制 | VNC (x11vnc) | - |
| 配置格式 | YAML | - |

## 项目结构

```
.
├── docker-compose.yml         # Docker Compose 配置
├── README.md                  # 项目说明文档
├── chromium-vnc/             # Chromium 浏览器容器
│   ├── Dockerfile             # 浏览器容器构建配置
│   ├── supervisord.conf       # 进程管理配置
│   ├── start_chromium.sh      # 浏览器 启动脚本
│   └── start_vnc.sh           # VNC 启动脚本
├── crontab/                  # 定时任务容器
│   ├── Dockerfile             # 定时任务容器构建配置
│   ├── crontab.default        # 定时任务配置示例
│   └── start.sh               # 容器启动脚本
└── config/                   # docker-compose 挂载的文件
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
        └── utils.js           # 工具函数


```

## NodeJS项目 核心模块说明

### 1. BrowserManager

负责管理 CDP 连接和标签页：
- 维护多个标签页的 WebSocket 连接
- 支持连接复用和生命周期管理
- 自动检测并关闭空闲浏览器

### 2. ActionExecutor

执行签到操作引擎：
- 支持多种操作类型：goto、action、wait、check、cwait、ccheck
- 自动注入 jQuery（goto 除外）
- 180秒操作超时控制
- 3次重试机制（指数退避）

### 3. SiteFilter

站点筛选逻辑：
- 过滤已暂停的站点
- 过滤已过期的站点
- 过滤今日已成功签到的站点

## 配置文件说明

### 配置文件格式

复制 `config.example.yaml` 为 `config.yaml` 并修改配置：

```yaml
- domain: "baidu.com"              # 浏览器标签页筛选标识
  date: "2026-05-13"              # 上一次执行日期
  status: 0                        # 失败次数 (0=成功)
  pause: false                     # 暂停此任务
  retry: false                     # 是否重试失败任务
  actions:
    - goto: "https://www.baidu.com"   # 导航到指定 URL
    - wait: "#chat-input-area"         # 等待指定元素出现
    - action: "$('#search_btn')[0].click()"  # 执行 jQuery 操作
    - check: "#success-badge"          # 检查元素存在（不重试）
    - cwait: "return document.readyState === 'complete'"  # 自定义等待条件
    - ccheck: "return $('#result').length > 0"  # 自定义检查条件
```

### 配置字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| domain | string | 是 | 站点域名（用于标签页筛选） |
| expireDate | string | 否 | 过期日期 (ISO格式) |
| date | string | 是 | 最后签到日期（ISO格式） |
| status | number | 是 | 签到状态 (0=成功, >0=失败次数) |
| pause | boolean | 是 | 是否暂停签到 |
| retry | boolean | 否 | 是否重试失败任务,<br/>禁用失败重试失败时会保留标签页，等待人工操作,操作完成后关闭该标签页则下次执行会将该任务标记成功<br/>启用失败重试后失败会关闭标签页，并在下次重新进行完整流程 |
| actions | array | 是 | 签到操作列表 |

### 操作类型说明

| 类型 | 说明 | 自动注入 jQuery |
|------|------|----------------|
| `goto` | 导航到指定 URL | ❌ |
| `action` | 执行 JavaScript/jQuery 代码 | ✅ |
| `wait` | 等待指定选择器的元素出现（超时时间内不断重试） | ✅ |
| `check` | 检查指定选择器的元素是否存在（不会重试） | ✅ |
| `cwait` | 执行自定义 JavaScript 返回 true 时停止等待（超时时间内不断重试） | ✅ |
| `ccheck` | 执行自定义 JavaScript 检查（不会重试，返回 false 则中断） | ✅ |

### 操作示例

```yaml
# 导航到页面
- goto: "https://example.com/login"

# 等待登录按钮出现（使用 CSS 选择器）
- wait: "#login-btn"

# 执行点击操作（使用 jQuery）
- action: "$('#login-btn').click()"

# 执行原生 JavaScript
- action: "document.getElementById('username').value = 'user'"

# 等待条件满足（自定义 JS）
- cwait: " !document.querySelector('.captcha')"

# 检查元素是否存在（不重试）
- check: ".success-message"

# 自定义检查（不重试）
- ccheck: " !!$('#balance').length"
```

### CDP 方法说明

内部使用的 CDP 方法：
- `Page.navigate` - 导航到指定 URL（用于 goto）
- `Runtime.evaluate` - 执行 JavaScript 代码（用于其他操作）

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
| VNC_PASS | VNCpass123! | VNC 密码,用于远程控制浏览器 |

### node 容器

| 变量 | 默认值 | 说明 |
|------|--------|------|
| WAIT_CHECK_INTERVAL | 2000 | 检查间隔(毫秒) |
| OPERATION_TIMEOUT | 180000 | 操作超时(毫秒) |
| MAX_CONCURRENT_SITES | 3 | 最大并发站点数(此数值越高，chromium-vnc容器资源占用也越高) |

## 快速开始

### 1. 配置站点

复制并编辑 `config.example.yaml`：

```bash
cp config.example.yaml config.yaml
# 编辑 config.yaml 添加签到站点配置
```

### 2. 启动容器

```bash
docker-compose up -d
```

### 3. VNC 连接（站点认证）

仅首次使用或站点认证信息过期时需要：

使用 VNC 客户端连接到 `localhost:5900`，密码为 `VNCpass123!`，打开浏览器访问站点进行认证操作。
认证信息(cookie seesion 等)会保留在 bowser 容器的 /root/.config/chromium 下

### 4. 触发签到任务

```bash
docker exec -it node node ./main.js
```

### 5. 定时任务配置

```cron
# 已新增容器内定时任务，无需从主机发起调用
# 直接修改 crontab 容器的 crontab.default, 立刻生效(示例中docker-compose.yml 使用 config/crontab)
*/20 3-23 * * * cd /app && node ./main.js
```

### 6. 查看日志

```bash
# 查看容器日志
docker-compose logs -f node
# 或者查看配置文件 的date/status值
cat config.yaml
```

### 7. VNC 连接（人工处理）

使用 VNC 客户端连接到 `localhost:5900`，密码为 `VNCpass123!`：
- 若浏览器未运行，则无需操作。所有任务正常完成后会自动关闭浏览器，降低资源占用。
- 若浏览器已运行，则操作对应界面，操作完成后关闭相应标签页（或关闭浏览器），下一次执行会自动将该站点标为成功状态。

## 业务流程

```
1. 读取配置文件 (config.yaml)
    ↓
2. 筛选待签到站点
   ├─ expireDate > 今天 (过期的站点 将 pause设为true)
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
   ├─ wait: 等待元素出现
   ├─ action: 执行操作
   ├─ check: 验证结果
   └─ cwait/ccheck: 自定义检查
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
3. **配置文件**：`./config/chromium-data` 包含浏览器认证信息，建议限制权限。
4. **验证码处理**：遇到失败时保留标签页，等待人工处理。
5. **jQuery CDN**：默认使用 bootcdn 加载 jQuery，请确保网络可访问。

## 故障排除

### 浏览器无法启动

检查 supervisord 日志：
```bash
docker-compose logs browser
```

### 签到失败

检查 node 容器日志：
```bash
docker-compose logs node
```

### VNC 连接失败

确保端口未被占用：
```bash
netstat -tlnp | grep 5900
```

### jQuery 加载失败

检查网络连接或修改 `actionExecutor.js` 中的 jQuery CDN 地址。

## 贡献

欢迎提交 Issue 和 Pull Request！