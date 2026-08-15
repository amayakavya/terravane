@echo off
cd /d "%~dp0"

echo Starting local chain...
start "Terravane Chain" cmd /k "npx hardhat node"

echo Waiting for chain to come up...
timeout /t 8 /nobreak >nul

echo Deploying contracts...
call node scripts\deploy.js
if errorlevel 1 (
    echo Deploy failed. Leaving chain window open for inspection.
    pause
    exit /b 1
)

echo Seeding demo data...
call node scripts\seed.js

echo Starting server...
start "Terravane Server" cmd /k "node server\index.js"

echo Waiting for server to come up...
timeout /t 3 /nobreak >nul

echo Opening browser...
start "" "http://localhost:4300"

echo Done. Two windows are running: Terravane Chain and Terravane Server.
echo Close both windows when you're done, or just close this window last.
pause
