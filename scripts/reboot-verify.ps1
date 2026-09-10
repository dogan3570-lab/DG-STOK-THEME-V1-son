# DG-STOK Post-Reboot Verification Script
# Bu script PC reboot + login sonra otomatik calisir ve sonuclari dosyaya yazar.

$resultFile = "C:\PROJE 1\DG-STOK-THEME-V1\scripts\reboot-test-result.txt"
$lines = @()
$pass = 0
$fail = 0

function Check($name, $ok, $detail) {
    if ($ok) { $script:pass++; "$name : PASS $detail" } else { $script:fail++; "$name : FAIL $detail" }
}

$lines += "========================================="
$lines += "DG-STOK POST-REBOOT VERIFICATION"
$lines += "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$lines += "========================================="
$lines += ""

# 1. PM2 daemon check
$pm2PidFile = "C:\Users\Dogan\.pm2\pm2.pid"
$pm2Pid = Get-Content $pm2PidFile -ErrorAction SilentlyContinue
$pm2Running = if ($pm2Pid) { Get-Process -Id $pm2Pid -ErrorAction SilentlyContinue } else { $null }
$lines += Check "PM2 daemon running" ($null -ne $pm2Running) "(PID: $pm2Pid)"

# 2. pm2 ls - dg-stok ONLINE
$pm2Out = pm2 ls 2>&1 | Out-String
$dgStokOnline = $pm2Out -match "dg-stok" -and $pm2Out -match "online"
$lines += Check "dg-stok ONLINE in PM2" $dgStokOnline ""
$dgLine = ($pm2Out -split "`n" | Where-Object { $_ -match "dg-stok" } | Select-Object -First 1).Trim()
if ($dgLine) { $lines += "  $dgLine" }

# 3. Port 4000 LISTEN
$p4000 = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
$lines += Check "Backend :4000 LISTEN" ($null -ne $p4000 -and $p4000.Count -gt 0) ""
if ($p4000) { $lines += "  PID: $($p4000[0].OwningProcess)" }

# 4. Port 5175 LISTEN
$p5175 = Get-NetTCPConnection -LocalPort 5175 -State Listen -ErrorAction SilentlyContinue
$lines += Check "Vite :5175 LISTEN" ($null -ne $p5175 -and $p5175.Count -gt 0) ""
if ($p5175) { $lines += "  PID: $($p5175[0].OwningProcess)" }

# 5. Watchdog Task Scheduler status
$task = Get-ScheduledTask -TaskName "DG-STOK Watchdog" -ErrorAction SilentlyContinue
$lines += Check "Task Scheduler: DG-STOK Watchdog exists" ($null -ne $task) ""
if ($task) {
    $lines += "  State: $($task.State)"
    $lines += Check "  StartWhenAvailable=True" ($task.Settings.StartWhenAvailable -eq $true) ""
    $lines += Check "  DisallowStartIfOnBatteries=False" ($task.Settings.DisallowStartIfOnBatteries -eq $false) ""
    $lines += Check "  StopIfGoingOnBatteries=False" ($task.Settings.StopIfGoingOnBatteries -eq $false) ""
    $lines += Check "  ExecutionTimeLimit=PT0S" ($task.Settings.ExecutionTimeLimit -eq "PT0S") ""
}

# 6. Watchdog PS1 process running
$watchdogPs = Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
    $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
    $cmdLine -match "dgstok-watchdog"
}
$lines += Check "Watchdog PS1 process running" ($null -ne $watchdogPs -and $watchdogPs.Count -gt 0) ""
if ($watchdogPs) { $lines += "  PIDs: $(($watchdogPs | ForEach-Object { $_.Id }) -join ', ')" }

# 7. Startup folder
$lnkPath = "C:\Users\Dogan\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\DG-STOK-Services.lnk"
$lines += Check "Startup: DG-STOK-Services.lnk exists" (Test-Path $lnkPath) ""

# 8. VBS autostart
$vbsPath = "C:\PROJE 1\DG-STOK-THEME-V1\scripts\dgstok-autostart.vbs"
$lines += Check "Autostart: dgstok-autostart.vbs exists" (Test-Path $vbsPath) ""

# 9. PM2 dump
$dump = Get-Content "C:\Users\Dogan\.pm2\dump.pm2" -Raw -ErrorAction SilentlyContinue
$lines += Check "PM2 dump: dg-stok saved" ($dump -and $dump -match 'dg-stok') ""

# 10. Backend yanit
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:4000" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    $lines += Check "Backend :4000 yanit" $true "(HTTP $($resp.StatusCode))"
} catch {
    if ($_.Exception.Response) {
        $lines += Check "Backend :4000 yanit" $true "(HTTP $($_.Exception.Response.StatusCode.value__))"
    } else {
        $lines += Check "Backend :4000 yanit" $false ""
    }
}

# Summary
$lines += ""
$lines += "========================================="
$lines += "TOTAL: $($pass + $fail) checks | PASS: $pass | FAIL: $fail"
if ($fail -eq 0) { $lines += "RESULT: ALL PASS" } else { $lines += "RESULT: $fail FAILURES" }
$lines += "========================================="

# Write to file
$lines | Out-File -FilePath $resultFile -Encoding UTF8
Write-Host ($lines -join "`n")
