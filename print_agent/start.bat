@echo off
chcp 65001 > nul
echo ============================================================
echo   Bixolon 라벨 프린터 에이전트 시작
echo ============================================================

REM Python이 설치되어 있는지 확인
python --version > nul 2>&1
if errorlevel 1 (
    echo [오류] Python이 설치되지 않았습니다.
    echo Python 3.8 이상을 설치 후 다시 시도하세요.
    pause
    exit /b 1
)

REM 필수 패키지 설치 (최초 1회)
echo 필수 패키지 확인 중...
pip install -r "%~dp0requirements.txt" --quiet

echo.
echo 에이전트를 시작합니다...
echo 브라우저에서 인쇄 요청을 받을 준비가 되었습니다.
echo 종료하려면 Ctrl+C 를 누르세요.
echo.

python "%~dp0agent.py"

pause
