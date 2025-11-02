@echo off
REM Check if npm/node is installed
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo npm is not installed. Installing Node.js and npm...

    REM Download and run Node.js installer
    powershell -Command "& {$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest 'https://nodejs.org/dist/lts/node-v20.10.0-x64.msi' -OutFile '%TEMP%\node-installer.msi'; Start-Process -FilePath '%TEMP%\node-installer.msi' -ArgumentList '/quiet /norestart' -Wait; Remove-Item '%TEMP%\node-installer.msi'}"

    echo Node.js installation complete. Refreshing environment...
    REM Refresh environment variables
    setlocal enabledelayedexpansion
    for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH') do set "PATH=%%b"
) else (
    echo npm is already installed.
)

echo Installing pnpm...
powershell -Command "& {Invoke-WebRequest 'https://get.pnpm.io/install.ps1' -UseBasicParsing | Invoke-Expression}"

echo pnpm installation complete!
echo Installing Vermcord...

REM Run pnpm i in a separate cmd window and wait for it to close
echo Running: pnpm i
start /wait cmd /c "pnpm i"

REM Run pnpm build in a separate cmd window and wait for it to close
echo Running: pnpm build
start /wait cmd /c "pnpm build"

REM Run pnpm inject normally in the current window
echo Running: pnpm inject
pnpm inject

cls
echo Vermcord Installed!
pause
