@echo off
cd /d "%~dp0"
echo Starting McAiBot (dev mode)...
node --watch index.js
pause
