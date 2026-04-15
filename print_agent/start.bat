@echo off
python --version > nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed.
    pause
    exit /b 1
)

echo Installing required packages...
pip install Pillow qrcode pywin32 --quiet

echo.
echo Starting label printer agent on port 9100...
echo Press Ctrl+C to stop.
echo.

python "%~dp0agent.py"

pause
