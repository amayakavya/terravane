@echo off
cd /d "%~dp0"

echo Starting local chain...
start "Terravane Chain" cmd /k "npx hardhat node"

echo Waiting for chain to come up...
set RETRIES=0
:WAIT_CHAIN
powershell -NoProfile -Command "exit (New-Object System.Net.Sockets.TcpClient).ConnectAsync('127.0.0.1',8545).Wait(500)" >nul 2>&1
if %errorlevel% equ 1 goto CHAIN_UP
set /a RETRIES+=1
if %RETRIES% geq 60 (
    echo Chain did not come up in time. Leaving chain window open for inspection.
    pause
    exit /b 1
)
goto WAIT_CHAIN
:CHAIN_UP

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
set RETRIES=0
:WAIT_SERVER
powershell -NoProfile -Command "exit (New-Object System.Net.Sockets.TcpClient).ConnectAsync('127.0.0.1',4300).Wait(500)" >nul 2>&1
if %errorlevel% equ 1 goto SERVER_UP
set /a RETRIES+=1
if %RETRIES% geq 30 (
    echo Server did not come up in time. Leaving server window open for inspection.
    pause
    exit /b 1
)
goto WAIT_SERVER
:SERVER_UP

echo Opening browser...
start "" "http://localhost:4300"

echo Done. Two windows are running: Terravane Chain and Terravane Server.
echo Close both windows when you're done, or just close this window last.
pause
