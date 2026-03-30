@echo off
pip install pyserial websockets pyinstaller
pyinstaller --onefile --console --name scale_bridge scale_bridge.py
echo.
echo Build complete: dist\scale_bridge.exe
pause
