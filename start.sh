#!/bin/bash
# 분말검사 시스템 시작 스크립트 (Linux/Mac)

echo "======================================"
echo "  분말검사 시스템 서버 시작"
echo "======================================"
echo ""

# 가상환경 확인
if [ ! -f "venv/bin/activate" ]; then
    echo "[오류] 가상환경이 설정되지 않았습니다."
    echo "다음 명령어를 먼저 실행하세요:"
    echo "  python3 -m venv venv"
    echo "  source venv/bin/activate"
    echo "  pip install -r requirements.txt"
    echo ""
    exit 1
fi

# 가상환경 활성화
echo "[1/2] 가상환경 활성화 중..."
source venv/bin/activate

# 서버 실행
echo "[2/2] 서버 시작 중..."
echo ""
echo "서버가 시작되었습니다!"
echo "웹 브라우저에서 http://localhost:5000 으로 접속하세요."
echo ""
echo "서버를 종료하려면 Ctrl+C를 누르세요."
echo "======================================"
echo ""

python3 app.py

# 서버 종료 후
echo ""
echo "서버가 종료되었습니다."
