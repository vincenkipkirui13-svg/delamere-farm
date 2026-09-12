@echo off
setlocal
cd /d "%~dp0"
npm.cmd run seed || goto :fail
echo.
echo Demo data loaded successfully.
echo Next command: 04_START_DEV.cmd
endlocal
exit /b 0
:fail
echo.
echo Seed stopped because the previous command failed.
endlocal
exit /b 1
