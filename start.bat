@echo off
REM 분말검사 시스템 시작 스크립트 (Windows)

echo ======================================
echo   분말검사 시스템 서버 시작
echo ======================================
echo.

REM 가상환경 확인
if not exist "venv\Scripts\activate.bat" (
    echo [오류] 가상환경이 설정되지 않았습니다.
    echo 다음 명령어를 먼저 실행하세요:
    echo   python -m venv venv
    echo   venv\Scripts\activate
    echo   pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

REM 가상환경 활성화
echo [1/2] 가상환경 활성화 중...
call venv\Scripts\activate.bat

REM 서버 실행
echo [2/2] 서버 시작 중...
echo.
echo 서버가 시작되었습니다!
echo 웹 브라우저에서 http://localhost:5000 으로 접속하세요.
echo.
echo 서버를 종료하려면 Ctrl+C를 누르세요.
echo ======================================
echo.

python app.py

REM 서버 종료 후
echo.
echo 서버가 종료되었습니다.
pause
