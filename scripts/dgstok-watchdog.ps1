<#  DG-STOK Watchdog – ASLA ÇÖKMEZ, tüm hataları yakalar  #>
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$pm2 = "C:\Users\Dogan\AppData\Roaming\npm\pm2.cmd"

function Test-PortListening($port) {
    try {
        $result = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        return ($null -ne $result -and $result.Count -gt 0)
    } catch {
        return $false
    }
}

function Get-Pm2ProcessCount {
    try {
        $jlist = & $pm2 jlist 2>$null
        if ([string]::IsNullOrWhiteSpace($jlist)) { return -1 }
        $arr = $jlist | ConvertFrom-Json -AsHashtable -ErrorAction SilentlyContinue
        if ($null -eq $arr) { return -1 }
        if ($arr -is [array]) { return $arr.Count }
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

function Ensure-Backend {
    $port = 4000
    $listening = Test-PortListening $port
    if (-not $listening) {
        Write-Warning "Backend :$port kapali..."
        $procCount = Get-Pm2ProcessCount

        if ($procCount -gt 0) {
            # PM2'de process var ama port kapali - restart
            Write-Warning "PM2'de process var, restart yapiliyor..."
            try {
                & $pm2 restart dg-stok 2>$null | Out-Null
                Start-Sleep -Seconds 5
            } catch {
                Write-Warning "restart hatasi: $_"
                # Resurrect dene
                try {
                    & $pm2 resurrect 2>$null | Out-Null
                    Start-Sleep -Seconds 4
                } catch { }
            }
        } else {
            # PM2'de process yok - resurrect veya manuel start
            Write-Warning "PM2'de process yok, resurrect yapiliyor..."
            try {
                & $pm2 resurrect 2>$null | Out-Null
                Start-Sleep -Seconds 4
            } catch { }

            $portCheck = Test-PortListening $port
            if (-not $portCheck) {
                Write-Warning "resurrect basarisiz, manuel start yapiliyor..."
                try {
                    Push-Location "$root\server"
                    & $pm2 start "src\index.ts" --name dg-stok --interpreter "C:\Program Files\nodejs\node.exe" 2>$null | Out-Null
                    Pop-Location
                    Start-Sleep -Seconds 5
                } catch {
                    Write-Warning "manuel start hatasi: $_"
                    try { Pop-Location } catch { }
                }
            }
        }
    }
}

function Ensure-Vite {
    $port = 5175
    $listening = Test-PortListening $port
    if (-not $listening) {
        Write-Warning "Vite :$port kapali, baslatiliyor..."
        try {
            Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npx', 'vite' -WindowStyle Hidden -PassThru | Out-Null
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
