$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $releaseRoot

$releaseItems = @(
  'dist', 'src', 'public', 'scripts', 'tests', 'licenses', 'docs', 'verification',
  'index.html', 'package.json', 'package-lock.json', 'vite.config.js',
  'README.md', 'PLAY_GUIDE.md', 'VERIFICATION.md', 'THIRD_PARTY_NOTICES.md',
  'START_HUMAN_EXE.cmd'
)
foreach ($releaseItem in $releaseItems) {
  if (-not (Test-Path -LiteralPath $releaseItem)) {
    throw "Release input is missing: $releaseItem"
  }
}
Compress-Archive -LiteralPath $releaseItems -DestinationPath 'HUMAN_exe_Observatory_v2_Final.zip' -CompressionLevel Optimal -Force
Get-Item -LiteralPath 'HUMAN_exe_Observatory_v2_Final.zip' | Select-Object FullName, Length
Get-FileHash -LiteralPath 'HUMAN_exe_Observatory_v2_Final.zip' -Algorithm SHA256 | Select-Object Algorithm, Hash
