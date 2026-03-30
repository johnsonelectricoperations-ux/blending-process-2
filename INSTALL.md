# 분말검사 시스템 설치 가이드

## 1. 사전 준비

### 필수 소프트웨어
- Python 3.8 이상 (권장: Python 3.10 이상)
- Git (선택사항 - 소스코드 다운로드용)

### Python 설치 확인
```bash
python --version
# 또는
python3 --version
```

## 2. 프로젝트 파일 준비

### 방법 1: Git으로 클론 (권장)
```bash
git clone [repository-url]
cd powder_inspection
```

### 방법 2: 압축파일 다운로드
1. 프로젝트 폴더를 ZIP으로 압축하여 전달
2. 새 PC에 압축 해제
3. 압축 해제된 폴더로 이동

## 3. 가상환경 설정

### Windows 환경

#### 1) 가상환경 생성
```cmd
# 프로젝트 폴더에서 실행
python -m venv venv
```

#### 2) 가상환경 활성화
```cmd
venv\Scripts\activate
```
> 활성화되면 터미널 프롬프트 앞에 `(venv)`가 표시됩니다.

#### 3) 가상환경 비활성화 (종료 시)
```cmd
deactivate
```

### Linux/Mac 환경

#### 1) 가상환경 생성
```bash
python3 -m venv venv
```

#### 2) 가상환경 활성화
```bash
source venv/bin/activate
```

#### 3) 가상환경 비활성화 (종료 시)
```bash
deactivate
```

## 4. 필요한 라이브러리 설치

### 가상환경 활성화 후 실행
```bash
pip install -r requirements.txt
```

### 설치되는 라이브러리
- **Flask 3.0.0** - 웹 프레임워크
- **Flask-CORS 4.0.0** - CORS 처리 (Cross-Origin Resource Sharing)
- **tzdata** - 시간대 데이터 (한국 시간 KST 처리용)

### 설치 확인
```bash
pip list
```

## 5. 데이터베이스 파일 확인

프로젝트 폴더에 `database.db` 파일이 있는지 확인:
- 있으면: 기존 데이터와 함께 사용 가능
- 없으면: 서버 첫 실행 시 자동으로 생성됨

## 6. 서버 실행

### 가상환경이 활성화된 상태에서:

#### Windows
```cmd
python app.py
```

#### Linux/Mac
```bash
python3 app.py
```

### 실행 확인
터미널에 다음과 같은 메시지가 표시되면 성공:
```
 * Serving Flask app 'app'
 * Debug mode: on
WARNING: This is a development server. Do not use it in a production deployment.
 * Running on http://0.0.0.0:5000
```

## 7. 웹 브라우저에서 접속

브라우저 주소창에 다음 중 하나를 입력:
- `http://localhost:5000`
- `http://127.0.0.1:5000`
- 같은 네트워크의 다른 PC에서: `http://[서버PC의IP주소]:5000`

## 8. 일상적인 사용

### 서버 시작 (매번)
```bash
# 1. 프로젝트 폴더로 이동
cd powder_inspection

# 2. 가상환경 활성화
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# 3. 서버 실행
python app.py
```

### 서버 종료
- 터미널에서 `Ctrl + C` 누르기

## 9. 문제 해결

### 가상환경 활성화 오류 (Windows)
PowerShell에서 실행 정책 오류가 발생하면:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 포트 충돌 (5000번 포트가 이미 사용 중)
`app.py` 파일의 마지막 부분에서 포트 번호 변경:
```python
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)  # 5000 → 5001로 변경
```

### pip 업그레이드 필요 시
```bash
python -m pip install --upgrade pip
```

### 라이브러리 설치 오류
개별 설치 시도:
```bash
pip install Flask==3.0.0
pip install Flask-CORS==4.0.0
pip install tzdata
```

## 10. 백업 권장사항

정기적으로 백업할 파일:
- `database.db` - 모든 검사 데이터가 저장된 데이터베이스
- `.claude/` 폴더 - 설정 파일 (있는 경우)

## 11. 프로덕션 환경 배포 (선택사항)

개발 서버가 아닌 프로덕션 환경에서 사용하려면:
- **Gunicorn** (Linux/Mac) 또는 **Waitress** (Windows) 사용 권장
- 자세한 내용은 Flask 프로덕션 배포 문서 참조

### Waitress 사용 예시 (Windows)
```bash
pip install waitress
waitress-serve --host=0.0.0.0 --port=5000 app:app
```

## 지원

문제가 발생하면 다음을 확인하세요:
1. Python 버전이 3.8 이상인지
2. 가상환경이 활성화되어 있는지 (프롬프트에 `(venv)` 표시)
3. requirements.txt의 모든 라이브러리가 설치되었는지
4. database.db 파일이 있는지
5. 포트 5000이 다른 프로그램에 의해 사용되고 있지 않은지
