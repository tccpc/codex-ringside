# Codex Ringside

[English](README.md) · 简体中文

![背景设置](https://raw.githubusercontent.com/tccpc/codex-ringside/main/docs/images/background-settings.png)

在 Codex 桌面端的侧栏显示剩余额度圆环，悬停可看重置时间；点击圆环可以自定义 Codex 的背景：图片、壁纸或毛玻璃，透明度和模糊自由调节，图片还能裁剪、缩放和调整布局。仅支持 macOS。

这是非官方插件，与 OpenAI 无关。原理参考 [Codex Usage Card](https://github.com/Lorie7813/codex-usage-card)，署名见 [NOTICE](NOTICE)。

## 工作原理

- **额度**：启动 Codex 内置的 `codex app-server`，通过 stdio 调用 `account/rateLimits/read`，每 60 秒刷新一次。
- **显示**：通过本机调试端口 `127.0.0.1:39222` 把卡片注入到 `nav[data-app-navigation-rail]`。
- **背景**：同样通过调试端口，把 Codex 外壳层的背景清空，在页面最底层放一张图片。窗口属性由主进程控制，插件改不了，所以“透明”透出的是 Codex 自带的系统毛玻璃，壁纸来源显示的是对齐到屏幕位置的桌面壁纸。
- **启动**：Codex 的 `app.asar` 受完整性校验保护，不能修改，只能让它带调试端口启动。后台任务发现你从原图标打开 Codex 时，会在安全条件都满足的情况下有序退出，再带端口重开一次。

账号有几个额度窗口就显示几个圆环。圆环是分段刻度样式，环内显示剩余百分比和窗口名称（“5小时”或“周”）。额度充足时为青绿渐变，50% 及以下转为黄橙，低于 10% 转为橙红。

## 安装

一键安装需要 **macOS 13 或更高版本**（Apple Silicon 或 Intel），以及已登录的兼容桌面客户端。**无需自行安装 Node.js、npm、Homebrew 或 Xcode Command Line Tools。** 安装包自带专用 Node 和预编译 helper。开发验证使用 `/Applications/ChatGPT.app`，版本 `26.1027.30824`；其他客户端版本依赖相同内部结构，未逐一验证。命令行和设置面板目前使用中文。

### 方式一：一键安装（推荐）

在终端粘贴这一条命令：

```bash
curl -fsSL https://github.com/tccpc/codex-ringside/releases/latest/download/install.sh | /bin/bash
```

从 **0.2.0** 版本开始提供。脚本自动识别芯片架构（包括 Rosetta 下的终端），通过 HTTPS 下载对应安装包，校验 SHA-256 后安装到当前用户目录。安装和后台运行均使用插件自带的 Node，不依赖或更改系统 Node、Homebrew、终端配置，也不需要 `sudo`。安装过程不会关闭正在使用的客户端。

如果圆环还没出现，保存工作，用 ⌘Q 退出客户端，再点原图标打开。后台可能在符合下文条件时将刚启动的客户端重开一次。

只观察、不自动重开客户端：

```bash
curl -fsSL https://github.com/tccpc/codex-ringside/releases/latest/download/install.sh | /bin/bash -s -- --observe
```

想先审阅脚本，可以从 [Releases](https://github.com/tccpc/codex-ringside/releases) 下载 `install.sh`，阅读后执行 `/bin/bash install.sh`。加上 `--version 0.2.0` 可指定发行版本。应用不在默认位置时，先设置路径，再执行一键安装命令：

```bash
export CODEX_RINGSIDE_APP="/Applications/ChatGPT.app"
```

安装后查看状态和卸载也不需要 npm：

```bash
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" status
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" uninstall
```

### 方式二：让 AI 帮你安装

把下面整段提示词复制给能在你的 Mac 上运行命令的 AI 助手：

```text
请帮我在这台 Mac 上安装 Codex Ringside：https://github.com/tccpc/codex-ringside
先阅读 README，说明安装内容和本机调试端口的用途。
检查 macOS 13+ 和已登录的兼容客户端，不支持时停止。
使用 README 的一键安装入口；安装包自带 Node 和 helper，不要为此安装 Homebrew、Node 或 Xcode 命令行工具。
保留已有设置；应用不在默认位置时，先 export CODEX_RINGSIDE_APP 为检测到的路径。
安装后运行："$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" status
告诉我后台是否正常、圆环是否显示，并给出卸载命令。
需要重开客户端时提醒我保存工作后手动操作，不要主动关闭或强制结束客户端。
```

### 方式三：npm / 源码安装

适用于已有 **Node.js 22+ 和 Xcode Command Line Tools** 的开发者：

```bash
npx codex-ringside@latest install
```

此方式在本机编译 Swift helper，需要本机 Node 能正常运行。如果 `npx` 因 Homebrew 动态库缺失崩溃，直接使用方式一。仅下载 npm 包不会安装或启动后台；没有安装生命周期脚本。npm 用户仍可使用 `npx codex-ringside@latest <命令>` 查看状态、设置背景和卸载。

| 位置 | 内容 |
|---|---|
| `~/Library/Application Support/CodexRingside` | 程序、专用 Node 及许可证（一键安装）、helper、设置和状态 |
| `~/Library/LaunchAgents/com.codexringside.agent.plist` | 后台任务 |
| `~/Library/Logs/CodexRingside` | 日志 |
| `~/Library/Application Support/CodexRingside Backups` | 安装和迁移备份 |

应用路径按 `CODEX_RINGSIDE_APP`、旧变量 `CODEX_PLUS_APP`、保存的应用路径、默认 `/Applications/ChatGPT.app` 的顺序选择。

## 升级和从 Codex Plus 迁移

从本版起，**自动更新默认开启**。后台启动约一分钟后检查 GitHub 的最新正式发行版，之后每 6 小时检查一次；检查时间会保存，重启后台不会重复下载。发现更高版本后，自动下载对应架构的完整安装包，校验 SHA-256、版本及运行时，再升级程序和专用 Node。跳过草稿和预发行版，不会降级。网络或安装失败会记录原因，一小时后重试。

更新由独立任务执行，只重启插件后台，不关闭正在使用的客户端。现有应用路径、观察模式、背景、图片和自动更新开关都会保留；新后台未就绪时恢复原文件、运行时和运行状态。下载期间卸载、重新安装或关闭自动更新，会取消这次自动安装。

也可以立即更新、只检查或控制自动更新：

```bash
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" update
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" update --check
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" update --disable
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" update --enable
```

`status` 的 `update` 字段显示当前/最新版本、自动更新开关、检查时间、下次检查时间和失败原因；时间字段为 Unix 毫秒时间戳。更新日志在 `~/Library/Logs/CodexRingside/update.log` 和 `update.err.log`。指定版本安装后仍会跟随正式版；需要固定版本或保留源码改动时，运行 `update --disable`。

旧版用户先重新执行一次一键安装命令，获得自动更新功能。已有新版设置优先；首次从 Codex Plus 迁移会保留旧版设置，并停用 `com.codexplus.agent`。安装、更新切换和卸载共用互斥锁，不会互相覆盖。

备份保留在 `~/Library/Application Support/CodexRingside Backups/install-*`。`receipt.json` 记录原路径及后台运行状态，`0` 是原 Ringside 安装，`1` 是原 Codex Plus 安装。卸载不会删除备份，确认新版正常后可手动清理。

迁移和重装保留观察模式；`--observe` 可明确关闭自动接管。要重新开启，退出后台后将安装目录 `settings.json` 的 `allowClientRestart` 改为 `true`，再重新安装。备份包含本地路径及图片，不要上传。npm / 源码用户可用 `npx codex-ringside@latest update` 执行相同更新；更新成功后，已安装副本转为包含专用 Node 的独立安装，不修改源码工作区。继续用 `npx codex-ringside@latest install` 则仍需开发工具。

## 自定义背景

点击侧栏的圆环打开设置面板。先选来源，再用效果调外观，所有调节都立即生效。

面板顶部还能切换 Codex 的**外观模式**：跟随系统、浅色、深色。它和设置页的“模式”是同一个设置，改动会保存，并在两边同步。这里用的是 Codex 内部的设置函数，找不到时控件自动隐藏。

**来源**决定背景是什么：

| 来源 | 背景 |
|---|---|
| `default` 关闭 | Codex 原样 |
| `image` 图片 | 你选的图片，按窗口摆放 |
| `wallpaper` 壁纸 | 桌面壁纸，按窗口在屏幕上的位置对齐 |
| `glass` 毛玻璃 | 系统毛玻璃，实时透出桌面和其他窗口 |

**效果**用透明度和模糊两个滑块自由调节，毛玻璃来源本身就是模糊的，只有透明度。

**图片编辑**只对图片来源生效：

- 拖动预览调位置，滚轮缩放，也可以用缩放、水平、垂直滑块
- 布局：铺满、适应、拉伸、居中、平铺
- 裁剪：拖动方框选区域，“匹配窗口”会框出和窗口同比例的最大区域
- 调色：亮度、对比度、饱和度

换一张图片时，位置、缩放、裁剪和调色会重置，透明度和模糊保留。如果透明度已经高到看不见图片（95% 以上），选图片或切到图片、壁纸来源时会回到默认的 45%。

也可以用命令行设置，5 秒内生效：

```bash
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" background image ~/Pictures/photo.jpg --transparency 50 --blur 8
```

```bash
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" background --layout contain --zoom 120 --y 20
```

```bash
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" background --crop 10,0,80,60
```

```bash
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" background default
```

只写选项时保留当前来源，不带参数时打印当前设置。`--crop` 的四个数是左、上、宽、高的百分比，`--crop none` 取消裁剪。完整选项见不带参数运行安装目录内的 `bin/codex-ringside` 的用法提示。

使用限制：

- **看不到其他窗口的情况**：窗口属性由主进程控制，不改 Codex 就做不到清晰的真透明。提高透明度后，窗口聚焦时透出的是带模糊的系统毛玻璃，失焦时透出的是纯色底。
- **毛玻璃有条件**：Codex 只在窗口聚焦、且窗口小于 3840×2160 物理像素时开启毛玻璃，Retina 屏上约等于 1920×1080pt，或者在设置里开了不透明窗口时也不会有。条件不满足时，毛玻璃来源自动换成模糊后的壁纸，不会跳成纯色。
- **壁纸可能不准**：动态壁纸和航拍壁纸只能拿到系统提供的静态图，和屏幕上的画面可能不同，这时改用图片来源。
- **切换有延迟**：切换桌面空间后，壁纸最多 60 秒才更新；拖动窗口时壁纸有轻微跟随延迟。
- **页面自动适配**：内容区里方角、无边框、占满区域的不透明层会被当作页面背景清除，设置页这类圆角卡片变成半透明磨砂，文字依然清楚。终端、代码块和内嵌网页不处理。设计不同的页面可能漏掉，这时自带背景的地方保持原样。

## 查看状态

下载失败或 SHA-256 校验失败时，安装器会在更改现有安装前停止，可在网络恢复后重试。发行版缺少安装包时，请选择 0.2.0 或更高版本。通过一键入口安装后，无需检查系统 Node 或编译工具。

```bash
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" status
```

重点看 `cdp.windows[].card.placed`。背景看 `background`（保存的设置）和 `cdp.windows[].background`：`applied` 表示已生效，`nativeGlass` 为 `false` 表示 Codex 此刻关闭了毛玻璃。输出可能包含本机路径，分享前请先脱敏。

## 卸载

```bash
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" uninstall
```

新旧后台任务和自动更新任务会被移除，专用 Node 随程序一起卸载，程序、设置和日志进废纸篓，安装备份保留。当前窗口的注入界面会移除；调试端口会保持到客户端退出，下次正常启动后关闭。桌面应用文件未改动。

## 什么时候会重启 Codex

下面的条件全部满足才会重启，否则只记录原因，不做任何动作：

- 这是新进程，且只有一个实例，后台任务启动前就在运行的窗口永远不动
- 启动不超过 8 秒，在前台，启动后没有按键、点击或滚动
- 进程参数里没有调试端口，且端口空闲
- 距上次尝试超过 120 秒

退出只用系统的 `terminate()`，从不强杀。Codex 拒绝退出或 10 秒内没退出就放弃。

所以这些情况下本次不会出现圆环：打开后马上开始操作、登录时自动启动、Codex 已经开着时才安装、两分钟内连续重开。下次从原图标打开即可。原因记录在 `status` 的 `startup.event` 里。

## 风险

- **调试端口没有认证**：端口只绑定本机，但本机任何进程都能通过它在 Codex 窗口里执行 JS。不要转发或代理 39222 端口，也不要在装了不可信软件的机器上使用。
- **依赖内部接口**：依赖的 app-server 行为、侧栏 DOM 和外壳结构可能随客户端升级变化，导致额度或背景功能失效。发现异常时关闭背景或卸载插件。
- **启动变慢**：每次从原图标打开会多等几秒，窗口会重开一次。

## 隐私

只读取额度数据，不读项目文件、对话内容和 Codex 数据库，也没有遥测或数据上传。`auth.json` 只看修改时间，用来发现账号切换，不读内容。app-server 自身的网络请求由 Codex CLI 发出。自动更新会请求 GitHub 的公开发行接口并下载发行包，不使用账号令牌，不发送本机设置、路径或图片；可以用 `update --disable` 关闭自动请求。背景功能只读取系统壁纸和你选的图片，转换后存在本机的 `CodexRingside/background` 目录，不会上传。

## 开发

开发和源码构建仍需要 Node.js 22+ 与 Xcode Command Line Tools。一键安装的普通用户不需要这些工具。

```bash
npm ci --ignore-scripts
npm run verify
```

`npm run build:standalone` 构建本机架构的完整安装包，`npm run check:standalone` 使用包内真实 Node 和 helper，在系统开发工具不可用的隔离环境下验证安装、重装和回滚。CI 分别在 Apple Silicon 与 Intel 上运行此检查。

卡片样式可以用 `test/fixtures/card.html` 调试，不需要真实的 Codex。

完整开发和发布流程见 [贡献指南](CONTRIBUTING.md)、[发布指南](docs/RELEASING.md)；漏洞请通过 [私密安全报告](https://github.com/tccpc/codex-ringside/security/advisories/new) 提交。
