Option Explicit
Dim files, shell, folder, executable, command
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
executable = files.BuildPath(folder, "runtime\node.exe")
If Not files.FileExists(executable) Then executable = "node"
command = Chr(34) & executable & Chr(34) & " " & Chr(34) & files.BuildPath(folder, "server.js") & Chr(34)
shell.Run command, 0, False
