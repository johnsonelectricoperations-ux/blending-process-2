#!/bin/bash
# 분말검사 시스템 초기 설치 스크립트 (Linux/Mac)

echo "======================================"
echo "  분말검사 시스템 설치"
echo "======================================"
echo ""

# Python 설치 확인
if ! command -v python3 &> /dev/null; then
    echo "[오류] Python3가 설치되어 있지 않습니다."
    echo "Python 3.8 이상을 설치하세요."
    echo ""
    echo "Ubuntu/Debian: sudo apt-get install python3 python3-venv python3-pip"
    echo "macOS: brew install python3"
    exit 1
fi

echo "[확인] Python 설치됨"
python3 --version
echo ""

# 가상환경 생성
if [ -d "venv" ]; then
    echo "[정보] 가상환경이 이미 존재합니다."
    read -p "기존 가상환경을 삭제하고 새로 만드시겠습니까? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "기존 가상환경 삭제 중..."
        rm -rf venv
    else
        # 기존 가상환경 사용
        source venv/bin/activate
        echo "[2/3] 기존 가상환경 활성화됨"
        echo ""
        
        # pip 업그레이드
        echo "[3/3] 필요한 라이브러리 설치 중..."
        python3 -m pip install --upgrade pip
        
        # requirements.txt에서 패키지 설치
        if [ -f "requirements.txt" ]; then
            pip install -r requirements.txt
        else
            echo "[경고] requirements.txt 파일을 찾을 수 없습니다."
        fi
        
        echo ""
        echo "======================================"
        echo "  설치 완료!"
        echo "======================================"
        echo ""
        echo "다음 단계:"
        echo "  1. ./start.sh 실행하여 서버 시작"
        echo "  2. 웹 브라우저에서 http://localhost:5000 접속"
        echo ""
        exit 0
    fi
fi

echo "[1/3] 가상환경 생성 중..."
python3 -m venv venv
if [ $? -ne 0 ]; then
    echo "[오류] 가상환경 생성 실패"
    echo "python3-venv 패키지가 필요할 수 있습니다:"
    echo "Ubuntu/Debian: sudo apt-get install python3-venv"
    exit 1
fi
echo "[완료] 가상환경 생성 완료"
echo ""

# 가상환경 활성화
echo "[2/3] 가상환경 활성화 중..."
source venv/bin/activate

# pip 업그레이드
echo "[3/3] 필요한 라이브러리 설치 중..."
python3 -m pip install --upgrade pip

# requirements.txt에서 패키지 설치
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "[오류] 라이브러리 설치 실패"
        exit 1
    fi
else
    echo "[경고] requirements.txt 파일을 찾을 수 없습니다."
    echo "수동으로 라이브러리를 설치해야 합니다."
fi

echo ""
echo "======================================"
echo "  설치 완료!"
echo "======================================"
echo ""
echo "다음 단계:"
echo "  1. ./start.sh 실행하여 서버 시작"
echo "  2. 웹 브라우저에서 http://localhost:5000 접속"
echo ""
