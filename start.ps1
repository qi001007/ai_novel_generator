# SAFETY: AI-generated launcher. Review before running.
# Review date: 2026-10-21
# Operations: read-only port checks, start backend/frontend in new windows, open localhost page.
# No deletions, no registry/env changes, no admin, no network downloads, no secrets.
$ErrorActionPreference = "Stop"
$root = "D:\AI_novel_generator"

function Test-LocalPort {
    param([int]$Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect("127.0.0.1", $Port)
        return $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Close()
    }
}

function Wait-LocalPort {
    param([int]$Port, [int]$Seconds)
    for ($i = 0; $i -lt $Seconds; $i++) {
        if (Test-LocalPort -Port $Port) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

Write-Host "[1/3] Backend 127.0.0.1:8000"
if (Test-LocalPort -Port 8000) {
    Write-Host "      Already running."
}
else {
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoExit",
        "-Command",
        "Set-Location '$root\backend'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
    ) -WindowStyle Normal
    Write-Host "      Started in a new window."
}

Write-Host "[2/3] Frontend 127.0.0.1:5173"
if (Test-LocalPort -Port 5173) {
    Write-Host "      Already running."
}
else {
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoExit",
        "-Command",
        "Set-Location '$root\frontend'; npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
    ) -WindowStyle Normal
    Write-Host "      Started in a new window."
}

Write-Host "[3/3] Waiting for both services..."
$backendReady = Wait-LocalPort -Port 8000 -Seconds 30
$frontendReady = Wait-LocalPort -Port 5173 -Seconds 30
if (-not $backendReady -or -not $frontendReady) {
    Write-Host "One service is not ready. Check the two service windows for errors."
    Read-Host "Press Enter to close"
    exit 1
}

Start-Process "http://127.0.0.1:5173/novels/1"
Write-Host "Ready. Keep the two service windows open; close them to stop the app."
Start-Sleep -Seconds 2