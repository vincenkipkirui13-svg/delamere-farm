@echo off
setlocal
cd /d "%~dp0"
echo Starting Delamere Farm...
echo Keep this window open while the website is running.
echo Open http://localhost:3000 in your browser.
echo Press CTRL+C to stop the server.
node src/server.js
endlocal
