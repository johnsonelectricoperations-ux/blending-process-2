@echo off
REM 분말검사 시스템 초기 설치 스크립트 (Windows)

echo ======================================
echo   분말검사 시스템 설치
echo ======================================
echo.

REM Python 설치 확인
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Python이 설치되어 있지 않습니다.
    echo Python 3.8 이상을 설치하세요: https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

echo [확인] Python 설치됨
python --version
echo.

REM 가상환경 생성
if exist "venv" (
    echo [정보] 가상환경이 이미 존재합니다.
    choice /C YN /M "기존 가상환경을 삭제하고 새로 만드시겠습니까"
    if errorlevel 2 goto install_packages
    echo 기존 가상환경 삭제 중...
    rmdir /s /q venv
)

echo [1/3] 가상환경 생성 중...
python -m venv venv
if %errorlevel% neq 0 (
    echo [오류] 가상환경 생성 실패
    pause
    exit /b 1
)
echo [완료] 가상환경 생성 완료
echo.

:install_packages
REM 가상환경 활성화
echo [2/3] 가상환경 활성화 중...
call venv\Scripts\activate.bat

REM pip 업그레이드
echo [3/3] 필요한 라이브러리 설치 중...
python -m pip install --upgrade pip

REM requirements.txt에서 패키지 설치
if exist "requirements.txt" (
    pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo [오류] 라이브러리 설치 실패
        pause
        exit /b 1
    )
) else (
    echo [경고] requirements.txt 파일을 찾을 수 없습니다.
    echo 수동으로 라이브러리를 설치해야 합니다.
)

echo.
echo ======================================
echo   설치 완료!
echo ======================================
echo.
echo 다음 단계:
echo   1. start.bat 파일을 더블클릭하여 서버 시작
echo   2. 웹 브라우저에서 http://localhost:5000 접속
echo.
pause
