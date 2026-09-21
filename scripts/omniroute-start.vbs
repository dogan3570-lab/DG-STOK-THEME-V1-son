' OmniRoute'u GORUNUR PENCERE OLMADAN arka planda baslatir.
' Window style 0 = hidden, False = don't wait (non-blocking).
' Task Scheduler bu VBS'i wscript.exe ile cagirir; boylece node.exe konsolu GORUNMEZ.
Option Explicit
Dim WshShell, nodeExe, omniScript, omniDir
Set WshShell = CreateObject("WScript.Shell")

nodeExe = "C:\Program Files\nodejs\node.exe"
omniScript = "C:\Users\Dogan\AppData\Roaming\npm\node_modules\omniroute\bin\omniroute.mjs"
omniDir = "C:\Users\Dogan\AppData\Roaming\npm\node_modules\omniroute"

WshShell.CurrentDirectory = omniDir
' 0 = gizli pencere; True = bitmesini bekle (OmniRoute uzun sure calisir, bu yuzden False)
WshShell.Run """" & nodeExe & """ """ & omniScript & """", 0, False

Set WshShell = Nothing
