@echo off
REM SAFETY: AI-generated launcher. Review before running.
REM Review date: 2026-10-21
REM Operations: run start.ps1 (read-only port checks + start backend/frontend + open browser).
REM No deletions, no registry/env changes, no admin. To abort: close this window.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 pause