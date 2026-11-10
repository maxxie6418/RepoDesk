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

if not exist "node_modules\electron\dist\electron.exe" goto install_electron
if not exist "node_modules\electron\path.txt" goto install_electron
goto start_app

:install_electron
  echo Repairing Electron runtime configuration...
  node src\install-electron.cjs
  if errorlevel 1 (
    echo Electron runtime installation failed.
    pause
    exit /b 1
  )

:start_app
call npm run dev
if errorlevel 1 pause
endlocal
