@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\electron-vite\bin\electron-vite.js" (
  echo Installing RepoDesk dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

call npm run dev
if errorlevel 1 pause
endlocal
