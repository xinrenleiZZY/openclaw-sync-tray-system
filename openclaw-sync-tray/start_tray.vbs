' 模型健康监控中心 · OpenClaw 用量同步托盘 - 无窗口启动器
' 通过 WScript.Shell.Run(..., 0, False) 启动：SW_HIDE(0) = 完全不创建控制台窗口
' （比 powershell -WindowStyle Hidden 更彻底，后者在部分 Windows 上仍会残留最小化窗口）
' 用途：开机自启 / 快捷方式 / 安装脚本 一律调用本文件，保证托盘无任何黑窗/最小化 cmd。
' 可带可选参数，如：wscript.exe start_tray.vbs -SelfUpdate
Option Explicit
Dim shell, fso, dirPath, scriptPath, runArgs
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' 取本脚本所在目录（即安装目录，含中文路径也能正确处理）
dirPath = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = dirPath & "\sync_tray.ps1"

runArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """"
If WScript.Arguments.Count > 0 Then
    runArgs = runArgs & " " & WScript.Arguments(0)
End If

' intWindowStyle = 0 (SW_HIDE)，bWaitOnReturn = False（不阻塞）
shell.Run "powershell.exe " & runArgs, 0, False
