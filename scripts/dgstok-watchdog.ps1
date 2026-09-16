<#  DG-STOK Watchdog – ASLA ÇÖKMEZ, tüm hataları yakalar  #>
$ErrorActionPreference = 'Continue'

# FIX(WATCHDOG-SINGLETON): Ayni script Scheduled Task ve VBS olmak uzere iki
# farkli launcher'dan baslatiliyordu -> iki watchdog ayni anda pm2 restart atiyordu.
# Named mutex ile tek instance zorunlu; ikinci kopya hemen cikar.
$watchdogMutex = New-Object -TypeName System.Threading.Mutex -ArgumentList $false, 'Local\DgStokWatchdogSingleton'
if (-not $watchdogMutex.WaitOne(0)) {
    Write-Warning "Baska bir DG-STOK watchdog instance zaten calisiyor. Bu instance kapatiliyor."
    exit 0
}

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$pm2 = "C:\Users\Dogan\AppData\Roaming\npm\pm2.cmd"

function Test-PortListening($port) {
    # FIX(WATCHDOG-PORTFLAKE): Get-NetTCPConnection araliklarla bos donuyor ve
    # watchdog portu kapali sanip pm2 restart atiyordu (restart loop). Gercek TCP
    # baglanti denemesi kullan; IPv4 ve IPv6 (node :: bind) ayri ayri denenir.
    foreach ($addr in @('127.0.0.1', '::1')) {
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $iar = $client.BeginConnect($addr, $port, $null, $null)
            $connected = $iar.AsyncWaitHandle.WaitOne(1000)
            if ($connected) {
                $client.EndConnect($iar)
                $client.Close()
                return $true
            }
            $client.Close()
        } catch { }
    }
    return $false
}

function Get-Pm2ProcessCount {
    try {
        $jlist = & $pm2 jlist 2>$null
        if ([string]::IsNullOrWhiteSpace($jlist)) { return -1 }
        # FIX(WATCHDOG-5.1): ConvertFrom-Json -AsHashtable yalnız PS7+; bu script powershell.exe
        # (5.1) ile çalışıyor → parametre binding exception → catch → -1 → SADECE RESURRECT DÖNGÜSÜ
        # her 5 sn server'ı yeniden başlatıyordu. 5.1-uyumlu, çift-casing-tolerant sayım:
        # boş dizi "[]" = 0 süreç; aksi halde "name":"dg-stok" occurrence say.
        $joined = ($jlist -join '')
        if ($joined.Trim() -eq '[]') { return 0 }
        $count = ([regex]::Matches($joined, '"name":')).Count
        if ($count -gt 0) { return $count }
        # FALLBACK: jlist parse edilemiyorsa PM2 daemon'un cevap verdiği yeterli kanıt sayılır
        return 1
    } catch {
        return -1
    }
}

function Ensure-Pm2Daemon {
    try {
        $procCount = Get-Pm2ProcessCount

        if ($procCount -le 0) {
            Write-Warning "PM2 daemon calismiyor veya process listesi bos (count=$procCount), baslatiliyor..."
            & $pm2 update 2>$null | Out-Null
            Start-Sleep -Seconds 3

            # Resurrect - dump'taki process'leri geri getir
            & $pm2 resurrect 2>$null | Out-Null
            Start-Sleep -Seconds 4

            # Kontrol et
            $afterCount = Get-Pm2ProcessCount
            if ($afterCount -le 0) {
                Write-Warning "Resurrect basarisiz, tekrar deniyorum..."
                & $pm2 resurrect 2>$null | Out-Null
                Start-Sleep -Seconds 4
            }
        }
    } catch {
        Write-Warning "PM2 daemon kontrol hatasi: $_"
        try {
            & $pm2 update 2>$null | Out-Null
            Start-Sleep -Seconds 3
            & $pm2 resurrect 2>$null | Out-Null
            Start-Sleep -Seconds 4
        } catch {
            Write-Warning "PM2 recovery hatasi da denendi: $_"
        }
    }
}

function Get-DgStokAppInfo {
    $info = [pscustomobject]@{
        Exists    = $false
        Status    = $null
        UptimeSec = -1
    }
    try {
        # FIX(WATCHDOG-5.1): pm2 jlist ConvertFrom-Json PS5.1'de case-duplicate
        # anahtar (username/USERNAME) yuzunden throw ediyor -> yanlis "process yok"
        # tespiti ve resurrect dongusu. Bunun yerine PM2 pid dosyasi + process
        # StartTime kullan: JSON parse yok, guvenilir uptime.
        $pidFile = "C:\Users\Dogan\.pm2\pids\dg-stok-0.pid"
        if (-not (Test-Path $pidFile)) { return $info }
        $raw = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
        if ([string]::IsNullOrWhiteSpace($raw)) { return $info }
        $procId = 0
        if (-not [int]::TryParse($raw.Trim(), [ref]$procId)) { return $info }
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($null -eq $p) { return $info }
        if ($p.ProcessName -notmatch 'node') { return $info }
        $info.Exists = $true
        $info.Status = 'online'
        try {
            $info.UptimeSec = [int]((Get-Date) - $p.StartTime).TotalSeconds
        } catch {
            $info.UptimeSec = -1
        }
    } catch {
        # pid dosyasi okunamadi -> bilinmiyor, mevcut akis devam eder
    }
    return $info
}

function Ensure-Backend {
    $port = 4000
    # FIX(WATCHDOG-GRACE): DG-STOK boot suresi ~10 sn. Sabit sleep yerine gercek
    # PM2 pm_uptime tabanli startup grace: yeni baslamis process'e restart atma.
    $startupGraceSec = 30

    if (Test-PortListening $port) {
        $script:ConsecutivePortFails = 0
        return
    }

    # FIX(WATCHDOG-DEBOUNCE): Tek bir yanlis/gecici okuma restart tetiklemesin;
    # ardisik 2 basarisiz kontrol (>=5 sn) dogrulanmadan aksiyon alma.
    $script:ConsecutivePortFails = [int]$script:ConsecutivePortFails + 1
    if ($script:ConsecutivePortFails -lt 2) {
        Write-Warning "Port :$port kapali (ardisik deneme $($script:ConsecutivePortFails)/2), dogrulama bekleniyor."
        return
    }

    $appInfo = Get-DgStokAppInfo

    if ($appInfo.Exists) {
        if ($appInfo.Status -eq 'launching') {
            Write-Warning "dg-stok '$($appInfo.Status)' durumunda, startup grace bekleniyor."
            return
        }
        if ($appInfo.UptimeSec -ge 0 -and $appInfo.UptimeSec -lt $startupGraceSec) {
            Write-Warning "dg-stok startup grace icinde (uptime=$($appInfo.UptimeSec)s < ${startupGraceSec}s), restart atlanıyor."
            return
        }
        if ($script:LastBackendAction -and ((Get-Date) - $script:LastBackendAction).TotalSeconds -lt $startupGraceSec) {
            Write-Warning "Son watchdog aksiyonundan bu yana grace gecmedi, restart atlanıyor."
            return
        }

        # Process grace'i asti ama port hala kapali -> gercek ariza, toparla
        Write-Warning "dg-stok grace sonrasi hala port dinlemiyor, restart yapiliyor..."
        try {
            & $pm2 restart dg-stok 2>$null | Out-Null
            $script:LastBackendAction = Get-Date
            Start-Sleep -Seconds 5
        } catch {
            Write-Warning "restart hatasi: $_"
            try {
                & $pm2 resurrect 2>$null | Out-Null
                $script:LastBackendAction = Get-Date
                Start-Sleep -Seconds 4
            } catch { }
        }
        return
    }

    # PM2'de dg-stok process'i canli degil. Once grace, sonra resurrect/start.
    # FIX(WATCHDOG-NORESTART): pid dosyasi ile process eslesmedigi icin bu dal
    # yanlislikla tetiklenebiliyordu; burada restart yerine idempotent resurrect.
    if ($script:LastBackendAction -and ((Get-Date) - $script:LastBackendAction).TotalSeconds -lt $startupGraceSec) {
        Write-Warning "Son watchdog aksiyonundan bu yana grace gecmedi (process yok), islem atlanıyor."
        return
    }

    Write-Warning "PM2'de dg-stok canli degil, resurrect deneniyor..."
    try {
        & $pm2 resurrect 2>$null | Out-Null
        $script:LastBackendAction = Get-Date
        Start-Sleep -Seconds 4
    } catch { }

    if (Test-PortListening $port) { return }

    Write-Warning "resurrect basarisiz, manuel start yapiliyor..."
    try {
        Push-Location "$root\server"
        & $pm2 start "src\index.ts" --name dg-stok --interpreter "C:\Program Files\nodejs\node.exe" 2>$null | Out-Null
        Pop-Location
        $script:LastBackendAction = Get-Date
        Start-Sleep -Seconds 5
    } catch {
        Write-Warning "manuel start hatasi: $_"
        try { Pop-Location } catch { }
    }
}

function Ensure-Vite {
    $port = 5175
    $listening = Test-PortListening $port
    if (-not $listening) {
        Write-Warning "Vite :$port kapali, baslatiliyor..."
        try {
            Start-Process -FilePath 'pwsh.exe' -ArgumentList '-NoWindow', '-Command', 'npx vite' -NoNewWindow -PassThru | Out-Null
        } catch {
            Write-Warning "Vite baslatma hatasi: $_"
        }
    }
}

while ($true) {
    try {
        Ensure-Pm2Daemon
        Ensure-Backend
        Ensure-Vite
    } catch {
        Write-Warning "Watchdog ana dongu hatasi: $_"
    }
    Start-Sleep -Seconds 5
}
