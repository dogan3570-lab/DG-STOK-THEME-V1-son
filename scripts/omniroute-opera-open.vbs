Option Explicit
Dim WshShell, fso
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' OmniRoute'un ba?lamas?n? bekle
WScript.Sleep 20000

' Opera'y? a?
Dim operaPath
operaPath = "C:\Users\Dogan\AppData\Local\Programs\Opera\opera.exe"

If fso.FileExists(operaPath) Then
    WshShell.Run """" & operaPath & """ http://localhost:20128", 1, False
Else
    ' Varsay?lan taray?c?
    WshShell.Run "http://localhost:20128", 1, False
End If

Set WshShell = Nothing
Set fso = Nothing
