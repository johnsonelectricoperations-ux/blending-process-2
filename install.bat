@echo off
chcp 65001 >nul
title 분말 검사 시스템 - 설치 스크립트

echo ================================================
echo 분말 검사 시스템 - 초기 설치
echo ================================================
echo.

REM 현재 디렉토리로 이동
cd /d "%~dp0"

REM Python 설치 확인
echo [1/4] Python 설치 확인 중...
python --version >nul 2>&1
if errorlevel 1 (
    echo [오류] Python이 설치되어 있지 않습니다!
    echo.
    echo Python 설치 방법:
    echo 1. https://www.python.org/downloads/ 방문
    echo 2. "Download Python" 버튼 클릭
    echo 3. 설치 시 반드시 "Add Python to PATH" 체크!
    echo.
    pause
    exit /b 1
)

python --version
echo Python 설치 확인 완료!
echo.

REM pip 업그레이드
echo [2/4] pip 업그레이드 중...
python -m pip install --upgrade pip
echo.

REM 필요한 라이브러리 설치
echo [3/4] 필요한 라이브러리 설치 중...
pip install -r requirements.txt
if errorlevel 1 (
    echo [오류] 라이브러리 설치 실패!
    pause
    exit /b 1
)
echo 라이브러리 설치 완료!
echo.

REM 데이터베이스 초기화
echo [4/4] 데이터베이스 초기화 중...
python init_db.py
if errorlevel 1 (
    echo [오류] 데이터베이스 초기화 실패!
    pause
    exit /b 1
)
echo.

echo ================================================
echo 설치 완료!
echo ================================================
echo.
echo 다음 단계:
echo 1. "start.bat" 파일을 더블 클릭하여 서버 시작
echo 2. 웹 브라우저에서 http://localhost:5000 접속
echo.
echo 자세한 내용은 README.md 파일을 참고하세요.
echo.
pause
