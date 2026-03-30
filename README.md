# 분말검사 시스템 (Powder Inspection System)

Flask 기반의 분말 품질 검사 관리 시스템입니다.

## 빠른 시작

### Windows 사용자

1. **초기 설치** (처음 한 번만 실행)
   ```
   setup.bat 더블클릭
   ```

2. **서버 시작** (사용할 때마다)
   ```
   start.bat 더블클릭
   ```

3. **브라우저에서 접속**
   ```
   http://localhost:5000
   ```

### Linux/Mac 사용자

1. **초기 설치** (처음 한 번만 실행)
   ```bash
   ./setup.sh
   ```

2. **서버 시작** (사용할 때마다)
   ```bash
   ./start.sh
   ```

3. **브라우저에서 접속**
   ```
   http://localhost:5000
   ```

## 필요한 소프트웨어

- Python 3.8 이상 (권장: Python 3.10+)
- 웹 브라우저 (Chrome, Edge, Firefox 등)

## 주요 기능

- 📦 **수입검사**: 원재료 분말 품질 검사 관리
- 🔬 **배합검사**: 배합된 분말 품질 검사 관리
- 📊 **검사결과 조회**: 완료된 검사 결과 조회 및 상세보기
- 🔗 **추적성 조회**: LOT 번호 기반 원재료 추적
- 🏭 **배합작업 관리**: 배합 작업 등록 및 원재료 투입 관리
- 📋 **배합작업지시서**: 작업지시 생성 및 관리
- ⚙️ **관리자**: 분말 사양, 검사자, 배합 레시피 관리

## 상세 설치 가이드

자세한 설치 방법은 [INSTALL.md](INSTALL.md) 파일을 참조하세요.

## 파일 구조

```
powder_inspection/
├── app.py                  # Flask 서버 메인 파일
├── database.db            # SQLite 데이터베이스 (자동 생성)
├── requirements.txt       # Python 패키지 목록
├── templates/
│   └── index.html        # 메인 HTML 파일
├── static/
│   ├── js/
│   │   └── app.js       # 프론트엔드 JavaScript
│   └── css/
│       └── style.css    # 스타일시트
├── setup.bat             # Windows 설치 스크립트
├── setup.sh              # Linux/Mac 설치 스크립트
├── start.bat             # Windows 시작 스크립트
├── start.sh              # Linux/Mac 시작 스크립트
├── INSTALL.md            # 상세 설치 가이드
└── README.md             # 이 파일
```

## 데이터 백업

중요한 데이터는 `database.db` 파일에 저장됩니다. 정기적으로 백업하시기 바랍니다.

## 문제 해결

### 서버가 시작되지 않는 경우

1. Python이 설치되어 있는지 확인
2. 가상환경이 활성화되어 있는지 확인
3. 필요한 라이브러리가 모두 설치되어 있는지 확인
   ```bash
   pip list
   ```

### 포트 충돌 (5000번 포트가 이미 사용 중)

`app.py` 파일의 마지막 줄을 수정:
```python
app.run(host='0.0.0.0', port=5001, debug=True)  # 5000 → 5001
```

### 자세한 문제 해결 방법

[INSTALL.md](INSTALL.md) 파일의 "문제 해결" 섹션을 참조하세요.

## 기술 스택

- **Backend**: Python, Flask
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Database**: SQLite
- **Libraries**: Flask-CORS, tzdata

## 라이선스

Copyright © 2024-2026 Johnson Electric Operations

---

문의사항이나 버그 리포트는 개발팀에 연락하세요.
