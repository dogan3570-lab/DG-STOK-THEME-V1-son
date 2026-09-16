Option Explicit

Dim WshShell, fso
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

Dim projectRoot, scriptsDir, serverDir, pm2Bin, watchdogPs1

projectRoot = "C:\PROJE 1\DG-STOK-THEME-V1"
scriptsDir  = projectRoot & "\scripts"
serverDir   = projectRoot & "\server"
pm2Bin      = "C:\Users\Dogan\AppData\Roaming\npm\pm2.cmd"
watchdogPs1 = scriptsDir & "\dgstok-watchdog.ps1"

WshShell.CurrentDirectory = serverDir

If fso.FileExists(pm2Bin) Then
    ' 1) PM2 daemon baslat/guncelle
    WshShell.Run "cmd /c """ & pm2Bin & """ update", 0, True
    WScript.Sleep 3000

    ' 2) Save edilmis process'leri restaur et
    WshShell.Run "cmd /c """ & pm2Bin & """ resurrect", 0, True
    WScript.Sleep 4000

    ' 3) dg-stok process ve port dogrulama
    Dim checkOutput, jsonText
    Set checkOutput = WshShell.Exec("cmd /c """ & pm2Bin & """ jlist")
    jsonText = checkOutput.StdOut.ReadAll

    If InStr(jsonText, """name"":""dg-stok""") = 0 Then
        ' Process dump'ta yok - manuel start (node.exe ile, tsx shell script Windows'ta calismaz)
        WshShell.Run "cmd /c cd /d """ & serverDir & """ & """ & pm2Bin & """ start """ & serverDir & "\src\index.ts"" --name dg-stok --interpreter ""C:\Program Files\nodejs\node.exe""", 0, True
        WScript.Sleep 6000
    End If

    ' 4) Port 4000 kontrol - hala yoksa bir deneme daha
    Dim portCheck
    Set portCheck = WshShell.Exec("cmd /c powershell -Command ""(Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue) -ne $null""")
    Dim portResult
    portResult = portCheck.StdOut.ReadAll

    If InStr(portResult, "True") = 0 Then
        WshShell.Run "cmd /c cd /d """ & serverDir & """ & """ & pm2Bin & """ restart dg-stok", 0, True
        WScript.Sleep 5000
    End If
End If

' 5) Watchdog artik SADECE "DG-STOK Watchdog" Scheduled Task tarafindan baslatilir.
'    FIX(WATCHDOG-SINGLETON): VBS'in de watchdog baslatmasi cift instance yaratiyordu.
'    Ek guvence: dgstok-watchdog.ps1 named mutex ile ikinci kopyayi reddeder.

Set WshShell = Nothing
Set fso = Nothing
