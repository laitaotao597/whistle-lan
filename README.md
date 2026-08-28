# whistle-lan

基于 [Whistle](https://wproxy.org/) 的开发调试 CLI，提供 hosts 映射、HTTPS 调试、系统 hosts 导入和上游代理配置。

## 功能

- 管理持久 hosts 映射，并在服务运行时自动同步。
- 使用临时映射调试 HTTPS 请求。
- 启动时自动设置系统 HTTP/HTTPS 代理，停止时自动关闭。
- 导入系统 hosts，也可以按次关闭。
- 默认使用 `http://127.0.0.1:7890` 上游代理，支持关闭或更换地址。
- 提供 Whistle Web UI；默认用户名为 `uiAdmin`，每次启动生成新的随机密码。

## 安装

需要 Node.js 18 或更高版本。

### 从 npm 安装

使用 pnpm 全局安装：

```bash
pnpm add --global whistle-lan
w2-lan init
```

### 从 tgz 安装

从 GitHub Release 直接安装最新版本：

```bash
pnpm add --global "https://github.com/laitaotao597/whistle-lan/releases/latest/download/whistle-lan.tgz"
w2-lan init
```

也可以先[下载 tgz 安装包](https://github.com/laitaotao597/whistle-lan/releases/latest/download/whistle-lan.tgz)，再从本地文件安装：

```bash
pnpm add --global ./whistle-lan.tgz
w2-lan init
```

## 开发调试

```bash
# 启动服务并设置系统代理
w2-lan start

# 查看状态和 Web UI 地址
w2-lan status
w2-lan open

# 查询本次启动生成的 Web UI 密码
w2-lan config get password

# 临时关闭系统 hosts 导入和上游代理
w2-lan start --no-system-hosts --no-upstream

# 临时把 HTTPS 域名转发到本地 HTTP 服务
w2-lan start --mitm=app.example.test 127.0.0.1:3000

# 首次进行 HTTPS MITM 前安装并信任 Whistle Root CA
w2-lan ca

# 停止服务
w2-lan stop
```

## hosts 映射

```bash
# 添加或更新映射
w2-lan host app.example.test 127.0.0.1:3000
w2-lan host api.example.test http://127.0.0.1:3001

# 删除映射
w2-lan unhost app.example.test

# 同步并查看生成的规则
w2-lan sync
w2-lan rules
```

目标不带协议时保留原始请求协议和 Host。目标使用 `http://` 时，可以解密 HTTPS 请求并转发到 HTTP 服务。

`--mitm` 只解密指定的源域名；其他 HTTPS 域名保持透传。首次使用前需要在代理启动后运行 `w2-lan ca`，或在已连接代理的设备上访问 [http://rootca.pro/](http://rootca.pro/) 下载证书，并按系统提示信任。

`host` 和 `unhost` 会在服务运行时自动同步；服务未运行时，映射会在下次启动时加载。

## 系统代理与上游代理

`start` 默认设置本机系统代理，通常不需要单独执行 `w2-lan proxy`。

```bash
# 不修改系统代理
w2-lan start --no-system-proxy

# 手动设置或关闭系统代理
w2-lan proxy
w2-lan proxy 127.0.0.1:10098
w2-lan proxy off

# 临时更换或关闭上游代理
w2-lan start --upstream=http://127.0.0.1:8080
w2-lan start --no-upstream
```

## 配置

配置目录为 `~/.whistle-lan`，可通过 `WHISTLE_LAN_HOME` 更改。

| 字段 | 默认值 | 功能 |
| --- | --- | --- |
| `port` | `10098` | 服务端口 |
| `uiUsername` | `uiAdmin` | Web UI 用户名 |
| `uiPassword` | `null` | 固定 Web UI 密码；`null` 表示启动时随机生成 |
| `systemProxy` | `true` | 启停时自动设置和关闭系统代理 |
| `importSystemHosts` | `true` | 导入系统 hosts |
| `upstreamProxy` | `http://127.0.0.1:7890` | 上游代理地址；`null` 表示关闭 |
| `bypass` | 内置列表 | 直接连接、不经过上游代理的域名 |

```bash
w2-lan config
w2-lan config get port
w2-lan config set port 10099
w2-lan config set systemProxy false
w2-lan config set importSystemHosts false
w2-lan config set upstreamProxy null
w2-lan config set upstreamProxy http://127.0.0.1:8080
w2-lan config set bypass '["api.example.test"]'
```
