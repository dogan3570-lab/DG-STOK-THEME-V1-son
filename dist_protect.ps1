# DG-STOK DIST KORUMA
# Kullanım: .\dist_protect.ps1 -Action Backup|Deploy|Rollback
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('Backup','Deploy','Rollback','Check')]
    [string]$Action
)

$root = 'C:\PROJE 1\DG-STOK-THEME-V1'
$dist = Join-Path $root 'dist'
$backupRoot = Join-Path $root 'dist_backups'
$staging = Join-Path $root 'dist_staging'

$markers = @(
    'DG STOK V5.0',
    'panel-theme',
    'Kontrol Paneli',
    'XML Kaynakları',
    'Ürün Havuzu',
    'Kategori Eşleştirme',
    'Marka Eşleştirme',
    'Varyant Eşleştirme',
    'Listeleme',
    'Gönderime Hazır',
    'Pazaryeri Yönetimi',
    'Siparişler',
    'Raporlar',
    'Ayarlar',
    'Hesabım',
    'Yönetim',
    'Kâr/Zarar Motoru',
    'profit-engine'
)

function Get-Timestamp { return Get-Date -Format 'yyyy-MM-dd_HH-mm-ss' }

function Backup-Dist {
    if (-not (Test-Path $dist)) { Write-Error 'dist bulunamadı'; exit 1 }
    $ts = Get-Timestamp
    $dest = Join-Path $backupRoot $ts
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Copy-Item -LiteralPath $dist -Destination $dest -Recurse -Force
    Write-Host "Backup oluşturuldu: $dest"
}

function Test-Markers {
    $index = Join-Path $staging 'index.html'
    if (-not (Test-Path $index)) { Write-Error 'staging index.html yok'; return $false }
    $content = Get-Content $index -Raw -Encoding UTF8
    foreach ($m in $markers) {
        if ($content -notlike "*$m*") {
            Write-Warning "Marker bulunamadı: $m"
            return $false
        }
    }
    return $true
}

switch ($Action) {
    'Backup' { Backup-Dist }
    'Deploy' {
        # Staging'den production'a atomic deploy
        if (-not (Test-Path $staging)) { Write-Error 'staging yok'; exit 1 }
        if (-not (Test-Markers)) { Write-Error 'Smoke test FAIL'; exit 1 }
        Backup-Dist
        $tmp = "$dist.tmp"
        if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
        Rename-Item $dist $tmp
        Move-Item $staging $dist
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host 'Deploy başarılı'
    }
    'Rollback' {
        $latest = Get-ChildItem $backupRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $latest) { Write-Error 'Backup yok'; exit 1 }
        Backup-Dist
        Remove-Item $dist -Recurse -Force
        Copy-Item -LiteralPath $latest.FullName -Destination $dist -Recurse -Force
        Write-Host "Rollback yapıldı: $($latest.Name)"
    }
    'Check' {
        $index = Join-Path $dist 'index.html'
        if (-not (Test-Path $index)) { Write-Error 'dist index yok'; exit 1 }
        $content = Get-Content $index -Raw -Encoding UTF8
        $ok = $true
        foreach ($m in $markers) {
            if ($content -notlike "*$m*") { Write-Warning "Marker eksik: $m"; $ok = $false }
        }
        if ($ok) { Write-Host 'Tüm markerlar mevcut' } else { Write-Error 'Marker eksik' }
    }
}
