$ErrorActionPreference = "Stop"

$configPath = Join-Path $env:USERPROFILE ".codex\config.toml"
$marker = "[mcp_servers.novel_platform]"
$pythonPath = "E:\Anaconda\python.exe"
$serverPath = "E:\novel-generator\tools\novel_platform_mcp\server.py"

if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Codex config was not found: $configPath"
}

$existing = Get-Content -LiteralPath $configPath -Raw
if ($existing.Contains($marker)) {
    Write-Output "novel_platform MCP is already configured"
    exit 0
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = "$configPath.pre-novel-platform-$stamp.bak"
Copy-Item -LiteralPath $configPath -Destination $backupPath

$block = @"

[mcp_servers.novel_platform]
command = '$pythonPath'
args = ['$serverPath']
startup_timeout_sec = 60

[mcp_servers.novel_platform.env]
NOVEL_PLATFORM_API = 'http://127.0.0.1:8000'
NOVEL_PLATFORM_UI = 'http://127.0.0.1:5173'
PYTHONIOENCODING = 'utf-8'
PYTHONUTF8 = '1'
"@

Add-Content -LiteralPath $configPath -Value $block -Encoding UTF8
Write-Output "configured novel_platform MCP"
Write-Output "backup: $backupPath"
