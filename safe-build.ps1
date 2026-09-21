# DG-STOK Güvenli Build & Deploy
param(
    [switch]$SkipTests
)

$root = 'C:\PROJE 1\DG-STOK-THEME-V1'
Set-Location $root

$dist = Join-Path $root 'dist'
$staging = Join-Path $root 'dist_staging'
$backupRoot = Join-Path $root 'dist_backups'

function Get-Timestamp { return Get-Date -Format 'yyyy-MM-dd_HH-mm-ss' }

Write-Host '1. Backup alınıyor...'
$ts = Get-Timestamp
$backupDest = Join-Path $backupRoot $ts
New-Item -ItemType Directory -Path $backupDest -Force | Out-Null
Copy-Item -LiteralPath $dist -Destination $backupDest -Recurse -Force
Write-Host "Backup: $backupDest"

Write-Host '2. Staging temizleniyor...'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

Write-Host '3. Build staging e...'
npm run build -- --config vite.staging.config.js
if ($LASTEXITCODE -ne 0) {
    Write-Error 'Build başarısız, canlı dist korunuyor.'
    exit 1
}

Write-Host '4. Smoke test...'
$index = Join-Path $staging 'index.html'
if (-not (Test-Path $index)) { Write-Error 'staging index.html yok'; exit 1 }
$content = Get-Content $index -Raw -Encoding UTF8
$markers = @('DG STOK V5.0','panel-theme','Kontrol Paneli','XML Kaynakları','Ürün Havuzu','Kategori Eşleştirme','Marka Eşleştirme','Varyant Eşleştirme','Listeleme','Gönderime Hazır','Pazaryeri Yönetimi','Siparişler','Raporlar','Ayarlar','Hesabım','Yönetim','Kâr/Zarar Motoru','profit-engine')
$ok = $true
foreach ($m in $markers) {
    if ($content -notlike "*$m*") { Write-Warning "Marker eksik: $m"; $ok = $false }
}
if (-not $ok) { Write-Error 'Marker testi başarısız, deploy yapılmadı.'; exit 1 }

Write-Host '5. API health check...'
$health = Invoke-WebRequest -UseBasicParsing http://localhost:4000/api/health -TimeoutSec 5 -ErrorAction SilentlyContinue
if ($health.StatusCode -ne 200) { Write-Warning 'API health ulaşılamadı, devam ediliyor.' }

Write-Host '6. Atomic deploy...'
$tmp = "$dist.tmp"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Rename-Item $dist $tmp
Move-Item $staging $dist
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host '7. Live retest...'
$liveIndex = Get-Content (Join-Path $dist 'index.html') -Raw -Encoding UTF8
if ($liveIndex -notlike '*DG STOK V5.0*') { Write-Error 'Live retest başarısız'; exit 1 }

Write-Host 'Deploy başarılı'
