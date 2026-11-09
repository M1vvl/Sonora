Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
exe = base & "\release\win-unpacked\Sonara.exe"
If fso.FileExists(exe) Then
  sh.Run Chr(34) & exe & Chr(34), 1, False
Else
  MsgBox "Please build Sonara first: npm run pack", 48, "Sonara"
End If
