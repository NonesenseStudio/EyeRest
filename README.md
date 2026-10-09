# 护眼提醒 V0.1

Windows 上的 20-20-20 护眼提醒工具。默认工作 20 分钟、休息 20 秒；可在窗口右上角调整时长，设置会保存在本机。

## 环境
- Node.js 22.12+
- npm
- Windows 10/11

## 开发运行
```powershell
npm install
npm run dev
```

## 构建和预览
```powershell
npm run build
npm run preview
```

## Windows 便携版
在 Windows 上运行：
```powershell
npm run pack:win
```
产物位于 `release/`，通常为 `Eye Rest 0.1.0.exe`（文件名由 electron-builder 决定）。

## 快速预览提醒
在窗口右上角打开设置，将工作时长设为 1 分钟、休息时长设为 1 秒，保存后等待提醒。

## 说明
- 隐藏主窗口后，计时仍会在托盘继续；托盘右键可以退出。
- 今日统计记录工作时长、休息时长和完整休息次数，并保存在本机。
- 设置可启用登录 Windows 后自动启动，也可选择锁屏时暂停、解锁后继续。
- 时长与选项保存在本机；应用重启后倒计时从新周期开始。
- 睡眠唤醒时重新校准计时，不把睡眠时间计入工作时长。
- Windows 打包、窗口和托盘直接使用 `src/assets/icon.ico`；SVG 源文件仍保留在同目录。
