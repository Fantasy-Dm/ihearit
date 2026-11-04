# 听个响 · I Hear It 1.0

**你继续，俺在听。**

首个正式公开版本，版本号从 1.0.0 开始。当前需要配合 Kdenlive 工程使用。

- 自定义声音分组，使用目标样本与排除样本校准相似声音检索。
- 引导式建立样例库，支持编辑分组和增删、移动样本。
- 波形概览与局部缩放、选区、播放进度线及单击试听。
- 从工程音轨直接取样；确认候选后标记或留空裁切，支持备份与撤销。
- 分析在本地完成，界面和文件窗口使用中文。

## 下载

- `ihearit-v1.0.0-win-x64.zip`：Windows x64 通用便携完整版，解压后运行 `ihearit.exe`；不需要安装 Node.js、Python 或 npm 依赖。
- `ihearit-v1.0.0-source.zip`：通用源码包；Windows 用户可运行 `setup-and-start.bat`，自动准备指定版本 Node.js、安装锁定依赖并启动。
- `SHA256SUMS.txt`：上述文件的 SHA-256 校验值。

通用版从空白样例库开始；原始录音、个人库、缓存、日志和个人完整版不在公开发布中。Kdenlive/FFmpeg 需要自行安装。

应用源码采用 MIT。YAMNet 模型采用 Apache-2.0，Node.js、ONNX Runtime 与其他第三方组件保留各自声明，详见随包 `THIRD_PARTY_NOTICES.md`。自动候选需要人工试听确认。
