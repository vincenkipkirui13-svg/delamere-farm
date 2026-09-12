@echo off
setlocal
cd /d "%~dp0"

echo [1/4] Checking Node.js...
node --version || goto :fail

echo [2/4] Creating local environment file...
if not exist .env copy /Y .env.example .env >nul

echo [3/4] Installing dependencies...
npm.cmd install || goto :fail

echo [4/4] Initializing database and folders...
npm.cmd run setup || goto :fail

echo.
echo Setup completed successfully.
echo Next command: 03_SEED_DEMO_DATA.cmd
endlocal
exit /b 0
:fail
echo.
echo Setup stopped because the previous command failed.
endlocal
exit /b 1
