"""
분말 검사 시스템 - Flask 서버
Google Apps Script를 대체하는 로컬 웹서버
"""

from flask import Flask, render_template, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import sqlite3
import json
import os
import re
import gzip
from datetime import datetime
from zoneinfo import ZoneInfo
from contextlib import closing
import fitz  # PyMuPDF

app = Flask(__name__)
CORS(app)

# 정적 파일 브라우저 캐시 설정 (1시간) — 재접속 시 다시 다운로드하지 않음
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 3600

@app.after_request
def add_cache_and_gzip(response):
    """캐시 헤더 + gzip 압축 (추가 패키지 불필요, Python 내장 gzip 사용)"""
    # 정적 파일 캐시 헤더
    if response.content_type and (
        'javascript' in response.content_type or
        'text/css' in response.content_type or
        'image/' in response.content_type or
        'font/' in response.content_type
    ):
        response.headers['Cache-Control'] = 'public, max-age=3600'

    # gzip 압축: 브라우저가 지원하고, 텍스트 계열 응답이면 압축
    if (
        response.status_code == 200
        and not response.direct_passthrough
        and 'gzip' in request.headers.get('Accept-Encoding', '')
        and response.content_type
        and any(t in response.content_type for t in ('text/', 'javascript', 'json', 'xml', 'svg'))
        and len(response.get_data()) > 500
    ):
        data = gzip.compress(response.get_data(), compresslevel=6)
        response.set_data(data)
        response.headers['Content-Encoding'] = 'gzip'
        response.headers['Content-Length'] = len(data)

    return response

DATABASE = 'database.db'

# PDF 업로드 설정
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads', 'specs')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 최대 16MB

# ============================================
# 데이터베이스 헬퍼 함수
# ============================================

def get_db():
    """데이터베이스 연결"""
    conn = sqlite3.connect(DATABASE, timeout=30.0)  # 30초 타임아웃
    conn.row_factory = sqlite3.Row  # 딕셔너리 형태로 반환
    conn.execute('PRAGMA busy_timeout = 30000')  # 30초 대기
    conn.execute('PRAGMA journal_mode = WAL')  # WAL 모드로 동시성 향상
    return conn


def to_kst_str(value, fmt='%Y-%m-%d %H:%M'):
    """주어진 시간 문자열/객체를 KST 문자열로 변환해서 반환합니다.

    - DB에 저장된 시간은 보통 UTC(또는 무표시 naive)로 들어오므로
      이를 UTC로 간주하고 Asia/Seoul로 변환합니다.
    - 파싱 실패 시 원본 값을 그대로 반환합니다.
    """
    if value is None:
        return value

    # 이미 datetime 객체인 경우
    dt = None
    if isinstance(value, datetime):
        dt = value
    else:
        # 문자열 파싱 시도
        try:
            dt = datetime.fromisoformat(value)
        except Exception:
            try:
                dt = datetime.strptime(value, '%Y-%m-%d %H:%M:%S')
            except Exception:
                try:
                    dt = datetime.strptime(value, '%Y-%m-%d %H:%M:%S.%f')
                except Exception:
                    return value

    # naive이면 UTC로 간주
    if dt.tzinfo is None:
        try:
            dt = dt.replace(tzinfo=ZoneInfo('UTC'))
        except Exception:
            # ZoneInfo가 지원되지 않거나 실패 시 기본 처리
            dt = dt

    kst = dt.astimezone(ZoneInfo('Asia/Seoul'))
    return kst.strftime(fmt)


def convert_times_in_dict(d):
    """딕셔너리의 모든 시간 관련 키(키에 'time' 포함)를 KST 문자열로 변환합니다."""
    if not isinstance(d, dict):
        return d
    for k in list(d.keys()):
        if 'time' in k.lower():
            d[k] = to_kst_str(d.get(k))
    return d

def dict_from_row(row):
    """sqlite3.Row를 딕셔너리로 변환"""
    return dict(zip(row.keys(), row))

# ============================================
# 메인 페이지
# ============================================

@app.route('/')
def index():
    """메인 페이지 렌더링"""
    return render_template('index.html')

# ============================================
# API: 분말 목록
# ============================================

@app.route('/api/powder-list', methods=['GET'])
def get_powder_list():
    """분말 목록 조회 (category 파라미터로 필터링 가능)"""
    try:
        category = request.args.get('category', None)
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            if category:
                cursor.execute('SELECT powder_name FROM powder_spec WHERE category = ? ORDER BY powder_name', (category,))
            else:
                cursor.execute('SELECT powder_name FROM powder_spec ORDER BY powder_name')
            powders = [row[0] for row in cursor.fetchall()]
            return jsonify({'success': True, 'data': powders})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: 검사자 목록
# ============================================

@app.route('/api/inspector-list', methods=['GET'])
def get_inspector_list():
    """검사자 목록 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT name FROM inspector ORDER BY name')
            inspectors = [row[0] for row in cursor.fetchall()]
            return jsonify({'success': True, 'data': inspectors})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: 분말 사양 조회
# ============================================

@app.route('/api/powder-spec/<powder_name>', methods=['GET'])
def get_powder_spec(powder_name):
    """분말 사양 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM powder_spec WHERE powder_name = ?', (powder_name,))
            row = cursor.fetchone()
            if row:
                return jsonify({'success': True, 'data': dict_from_row(row)})
            else:
                return jsonify({'success': False, 'message': '분말 사양을 찾을 수 없습니다.'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: 입도분석 규격 조회
# ============================================

@app.route('/api/particle-size-spec/<powder_name>', methods=['GET'])
def get_particle_size_spec(powder_name):
    """입도분석 규격 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT mesh_size, min_value, max_value
                FROM particle_size
                WHERE powder_name = ?
                ORDER BY id
            ''', (powder_name,))
            specs = [dict_from_row(row) for row in cursor.fetchall()]
            return jsonify({'success': True, 'data': specs})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: 검사 항목 필터링
# ============================================

def get_inspection_items(powder_name, inspection_type, conn=None):
    """검사 타입에 따라 필요한 검사 항목 반환

    Args:
        powder_name: 분말명
        inspection_type: 검사 타입
        conn: 기존 DB 연결 (없으면 새로 생성)
    """
    # 연결이 제공되지 않은 경우 새로 생성
    owns_connection = conn is None
    if owns_connection:
        conn = get_db()

    try:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM powder_spec WHERE powder_name = ?', (powder_name,))
        spec = cursor.fetchone()

        if not spec:
            return []

        spec = dict_from_row(spec)

        # 모든 검사 항목 정의
        all_items = [
            {'name': 'FlowRate', 'displayName': '유동도', 'unit': 's/50g',
             'min': spec['flow_rate_min'], 'max': spec['flow_rate_max'], 'type': spec['flow_rate_type']},

            {'name': 'ApparentDensity', 'displayName': '겉보기밀도', 'unit': 'g/cm³',
             'min': spec['apparent_density_min'], 'max': spec['apparent_density_max'], 'type': spec['apparent_density_type'],
             'isWeightBased': True},

            {'name': 'CContent', 'displayName': 'C함량', 'unit': '%',
             'min': spec['c_content_min'], 'max': spec['c_content_max'], 'type': spec['c_content_type']},

            {'name': 'CuContent', 'displayName': 'Cu함량', 'unit': '%',
             'min': spec['cu_content_min'], 'max': spec['cu_content_max'], 'type': spec['cu_content_type']},

            {'name': 'Moisture', 'displayName': '수분도', 'unit': '%',
             'min': spec['moisture_min'], 'max': spec['moisture_max'], 'type': spec['moisture_type'],
             'isWeightBased': True},

            {'name': 'Ash', 'displayName': '회분도', 'unit': '%',
             'min': spec['ash_min'], 'max': spec['ash_max'], 'type': spec['ash_type'],
             'isWeightBased': True},

            {'name': 'SinterChangeRate', 'displayName': '소결변화율', 'unit': '%',
             'min': spec['sinter_change_rate_min'], 'max': spec['sinter_change_rate_max'], 'type': spec['sinter_change_rate_type']},

            {'name': 'SinterStrength', 'displayName': '소결강도', 'unit': 'MPa',
             'min': spec['sinter_strength_min'], 'max': spec['sinter_strength_max'], 'type': spec['sinter_strength_type']},

            {'name': 'FormingStrength', 'displayName': '성형강도', 'unit': 'N',
             'min': spec['forming_strength_min'], 'max': spec['forming_strength_max'], 'type': spec['forming_strength_type']},

            {'name': 'FormingLoad', 'displayName': '성형하중', 'unit': 'MPa',
             'min': spec['forming_load_min'], 'max': spec['forming_load_max'], 'type': spec['forming_load_type']},
        ]

        # 검사 타입에 따라 필터링
        filtered_items = []
        for item in all_items:
            item_type = item['type']

            # 검사 타입 필터링
            if inspection_type == '일상점검' and item_type == '일상':
                if item['min'] is not None or item['max'] is not None:
                    filtered_items.append(item)
            elif inspection_type == '정기점검' and (item_type == '일상' or item_type == '정기'):
                if item['min'] is not None or item['max'] is not None:
                    filtered_items.append(item)

        # 입도분석 항목 추가
        if spec['particle_size_type']:
            cursor.execute('''
                SELECT mesh_size, min_value, max_value
                FROM particle_size
                WHERE powder_name = ?
            ''', (powder_name,))
            particle_specs = [dict_from_row(row) for row in cursor.fetchall()]

            if particle_specs:
                particle_item_type = spec['particle_size_type']

                if inspection_type == '일상점검' and particle_item_type == '일상':
                    filtered_items.append({
                        'name': 'ParticleSize',
                        'displayName': '입도분석',
                        'unit': '%',
                        'isParticleSize': True,
                        'particleSpecs': particle_specs
                    })
                elif inspection_type == '정기점검' and (particle_item_type == '일상' or particle_item_type == '정기'):
                    filtered_items.append({
                        'name': 'ParticleSize',
                        'displayName': '입도분석',
                        'unit': '%',
                        'isParticleSize': True,
                        'particleSpecs': particle_specs
                    })

        return filtered_items
    finally:
        # 직접 생성한 연결만 닫기
        if owns_connection:
            conn.close()

# ============================================
# API: 검사 시작
# ============================================

def _do_start_inspection():
    """검사 시작 또는 기존 검사 이어하기 (내부 구현)"""
    data = request.json
    powder_name = data.get('powderName')
    lot_number = data.get('lotNumber')
    inspection_type = data.get('inspectionType')
    inspector = data.get('inspector')
    category = data.get('category', 'incoming')  # 기본값은 incoming
    inspection_date = data.get('inspectionDate')  # 검사일 추가

    if not all([powder_name, lot_number]):
        return jsonify({'success': False, 'message': '필수 입력 항목이 누락되었습니다.'})

    # Millsheet 파일 경로 (저장된 경우)
    sp = safe_name(powder_name)
    sl = safe_name(lot_number)
    millsheet_filepath = os.path.join(MILLSHEET_DIR, sp, f"{sp}_{sl}.pdf")
    millsheet_rel_path = f"millsheets/{sp}/{sp}_{sl}.pdf" if os.path.exists(millsheet_filepath) else None

    with closing(get_db()) as conn:
        cursor = conn.cursor()

        # 1. 진행중인 검사 확인
        cursor.execute('''
            SELECT * FROM inspection_progress
            WHERE powder_name = ? AND lot_number = ?
        ''', (powder_name, lot_number))
        progress_row = cursor.fetchone()

        if progress_row:
            # 기존 진행중 검사가 있음
            progress_data = dict_from_row(progress_row)
            items = get_inspection_items(powder_name, progress_data['inspection_type'], conn)

            # 이미 저장된 측정값들을 가져오기
            saved_values = {}
            cursor.execute('''
                SELECT * FROM inspection_result
                WHERE powder_name = ? AND lot_number = ?
            ''', (powder_name, lot_number))

            result_row = cursor.fetchone()
            if result_row:
                result_data = dict_from_row(result_row)

                # 컬럼명 매핑 (save_inspection_item 함수와 동일)
                column_map = {
                    'FlowRate': ['flow_rate_1', 'flow_rate_2', 'flow_rate_3', 'flow_rate_avg', 'flow_rate_result'],
                    'ApparentDensity': [
                        'apparent_density_empty_cup_1', 'apparent_density_powder_weight_1', 'apparent_density_1',
                        'apparent_density_empty_cup_2', 'apparent_density_powder_weight_2', 'apparent_density_2',
                        'apparent_density_empty_cup_3', 'apparent_density_powder_weight_3', 'apparent_density_3',
                        'apparent_density_avg', 'apparent_density_result'
                    ],
                    'CContent': ['c_content_1', 'c_content_2', 'c_content_3', 'c_content_avg', 'c_content_result'],
                    'CuContent': ['cu_content_1', 'cu_content_2', 'cu_content_3', 'cu_content_avg', 'cu_content_result'],
                    'Moisture': [
                        'moisture_initial_weight_1', 'moisture_dried_weight_1', 'moisture_1',
                        'moisture_initial_weight_2', 'moisture_dried_weight_2', 'moisture_2',
                        'moisture_initial_weight_3', 'moisture_dried_weight_3', 'moisture_3',
                        'moisture_avg', 'moisture_result'
                    ],
                    'Ash': [
                        'ash_initial_weight_1', 'ash_ash_weight_1', 'ash_1',
                        'ash_initial_weight_2', 'ash_ash_weight_2', 'ash_2',
                        'ash_initial_weight_3', 'ash_ash_weight_3', 'ash_3',
                        'ash_avg', 'ash_result'
                    ],
                    'SinterChangeRate': ['sinter_change_rate_1', 'sinter_change_rate_2', 'sinter_change_rate_3', 'sinter_change_rate_avg', 'sinter_change_rate_result'],
                    'SinterStrength': ['sinter_strength_1', 'sinter_strength_2', 'sinter_strength_3', 'sinter_strength_avg', 'sinter_strength_result'],
                    'FormingStrength': ['forming_strength_1', 'forming_strength_2', 'forming_strength_3', 'forming_strength_avg', 'forming_strength_result'],
                    'FormingLoad': ['forming_load_1', 'forming_load_2', 'forming_load_3', 'forming_load_avg', 'forming_load_result']
                }

                # 각 항목별로 저장된 값 추출
                for item in items:
                    item_name = item['name']

                    if item_name == 'ParticleSize':
                        # 입도분석: particle_180_1, particle_180_2 등
                        particle_values = {}
                        mesh_ids = ['180', '150', '106', '75', '45', '45M']
                        for mesh_id in mesh_ids:
                            col_1 = f'particle_{mesh_id}_1'
                            col_2 = f'particle_{mesh_id}_2'
                            if col_1 in result_data and col_2 in result_data:
                                particle_values[mesh_id] = {
                                    'value1': result_data.get(col_1),
                                    'value2': result_data.get(col_2)
                                }
                        if particle_values:
                            saved_values['ParticleSize'] = {'value1': json.dumps(particle_values)}
                    elif item_name in column_map:
                        columns = column_map[item_name]
                        item_values = {}

                        # 일반 항목: value1, value2, value3 저장
                        if item_name in ['ApparentDensity', 'Moisture', 'Ash']:
                            # 중량 기반: 각 측정차수마다 2개 값 (9개 컬럼 중 앞 9개)
                            for i in range(3):
                                item_values[f'value{i+1}'] = json.dumps([
                                    result_data.get(columns[i*3]),
                                    result_data.get(columns[i*3+1])
                                ])
                        else:
                            # 일반 항목: value1, value2, value3
                            for i in range(min(3, len(columns)-2)):
                                if result_data.get(columns[i]) is not None:
                                    item_values[f'value{i+1}'] = result_data.get(columns[i])

                        item_values['final_result'] = result_data.get(columns[-1])
                        saved_values[item_name] = item_values

            return jsonify({
                'success': True,
                'isExisting': True,
                'data': {
                    'powderName': progress_data['powder_name'],
                    'lotNumber': progress_data['lot_number'],
                    'inspectionType': progress_data['inspection_type'],
                    'inspector': progress_data['inspector'],
                    'startTime': to_kst_str(progress_data['start_time']),
                    'completedItems': json.loads(progress_data['completed_items'] or '[]'),
                    'totalItems': json.loads(progress_data['total_items'] or '[]'),
                    'progress': progress_data['progress'],
                    'category': progress_data.get('category', 'incoming'),
                    'inspectionDate': progress_data.get('inspection_date')
                },
                'items': items,
                'savedValues': saved_values  # 저장된 측정값 추가
            })

        # 2. 완료된 검사 확인
        cursor.execute('''
            SELECT * FROM inspection_result
            WHERE powder_name = ? AND lot_number = ?
        ''', (powder_name, lot_number))
        result_row = cursor.fetchone()

        if result_row:
            result_data = dict_from_row(result_row)
            return jsonify({
                'success': True,
                'isExisting': True,
                'data': {
                    'powderName': powder_name,
                    'lotNumber': lot_number,
                    'inspectionType': inspection_type,
                    'inspector': inspector,
                    'isCompleted': True,
                    'progress': '완료',
                    'category': result_data.get('category', 'incoming'),
                    'inspectionDate': result_data.get('inspection_date')
                },
                'items': []
            })

        # 3. 새 검사 시작
        items = get_inspection_items(powder_name, inspection_type, conn)

        if not items:
            # 일상검사 항목이 없는 분말 → Millsheet 확인 후 즉시 합격 처리
            if not millsheet_rel_path:
                return jsonify({
                    'success': False,
                    'needMillsheet': True,
                    'message': '이 분말은 일상검사 항목이 없습니다.\nMillsheet를 첨부하면 자동 합격 처리됩니다.'
                })
            cursor.execute('''
                INSERT INTO inspection_result
                (powder_name, lot_number, inspection_type, inspector, category, inspection_date, final_result, millsheet_path)
                VALUES (?, ?, ?, ?, ?, ?, 'PASS', ?)
            ''', (powder_name, lot_number, inspection_type, inspector, category, inspection_date, millsheet_rel_path))
            conn.commit()
            return jsonify({
                'success': True,
                'isAutoApproved': True,
                'message': '일상검사 항목이 없어 자동 합격 처리되었습니다.',
                'data': {
                    'powderName': powder_name,
                    'lotNumber': lot_number,
                    'inspectionType': inspection_type,
                    'inspector': inspector,
                    'category': category,
                    'inspectionDate': inspection_date,
                },
                'items': []
            })

        item_names = [item['name'] for item in items]

        # 진행중검사 테이블에 추가
        cursor.execute('''
            INSERT INTO inspection_progress
            (powder_name, lot_number, inspection_type, inspector, completed_items, total_items, progress, category, inspection_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (powder_name, lot_number, inspection_type, inspector,
              json.dumps([]), json.dumps(item_names), f'0/{len(item_names)}', category, inspection_date))

        conn.commit()

        return jsonify({
            'success': True,
            'isExisting': False,
            'data': {
                'powderName': powder_name,
                'lotNumber': lot_number,
                'inspectionType': inspection_type,
                'inspector': inspector,
                'completedItems': [],
                'totalItems': item_names,
                'category': category,
                'inspectionDate': inspection_date
            },
            'items': items
        })


@app.route('/api/start-inspection', methods=['POST'])
def start_inspection():
    """검사 시작 또는 기존 검사 이어하기 (재시도 로직 포함)"""
    import time
    max_retries = 5
    retry_delay = 0.05  # 50ms

    last_error = None
    for attempt in range(max_retries):
        try:
            return _do_start_inspection()
        except Exception as e:
            if 'database is locked' in str(e).lower() and attempt < max_retries - 1:
                last_error = e
                time.sleep(retry_delay * (2 ** attempt))
                continue
            else:
                return jsonify({'success': False, 'message': str(e)})

    if last_error:
        return jsonify({'success': False, 'message': str(last_error)})

# ============================================
# API: 미완료 검사 목록
# ============================================

@app.route('/api/incomplete-inspections', methods=['GET'])
def get_incomplete_inspections():
    """진행중인 검사 목록 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM inspection_progress ORDER BY start_time DESC')
            inspections = [dict_from_row(row) for row in cursor.fetchall()]

            # JSON 파싱 및 시간(KST) 변환
            for inspection in inspections:
                inspection['completedItems'] = json.loads(inspection['completed_items'] or '[]')
                inspection['totalItems'] = json.loads(inspection['total_items'] or '[]')
                convert_times_in_dict(inspection)

            return jsonify({'success': True, 'data': inspections})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: 진행중인 검사 삭제
# ============================================

@app.route('/api/delete-incomplete-inspection/<powder_name>/<lot_number>', methods=['DELETE'])
def delete_incomplete_inspection(powder_name, lot_number):
    """진행중인 검사 삭제"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 진행중인 검사가 있는지 확인
            cursor.execute('''
                SELECT * FROM inspection_progress
                WHERE powder_name = ? AND lot_number = ?
            ''', (powder_name, lot_number))

            if not cursor.fetchone():
                return jsonify({'success': False, 'message': '진행중인 검사를 찾을 수 없습니다.'})

            # 진행중인 검사만 삭제 (완료된 검사는 삭제하지 않음)
            cursor.execute('''
                DELETE FROM inspection_progress
                WHERE powder_name = ? AND lot_number = ?
            ''', (powder_name, lot_number))

            conn.commit()

            return jsonify({'success': True, 'message': '진행중인 검사가 삭제되었습니다.'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: 검사자 업데이트
# ============================================

@app.route('/api/update-inspector', methods=['PUT'])
def update_inspector():
    """검사 진행 중 검사자 변경"""
    try:
        data = request.get_json()
        powder_name = data.get('powderName')
        lot_number = data.get('lotNumber')
        inspector = data.get('inspector')
        category = data.get('category', 'incoming')

        if not all([powder_name, lot_number, inspector]):
            return jsonify({'success': False, 'message': '필수 항목이 누락되었습니다.'})

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # inspection_progress 테이블 업데이트 (category도 조건에 포함)
            cursor.execute('''
                UPDATE inspection_progress
                SET inspector = ?
                WHERE powder_name = ? AND lot_number = ? AND category = ?
            ''', (inspector, powder_name, lot_number, category))

            # 진행중 검사 업데이트 성공 여부 확인
            progress_updated = cursor.rowcount > 0

            # inspection_result 테이블도 업데이트 (이미 생성된 경우)
            cursor.execute('''
                UPDATE inspection_result
                SET inspector = ?
                WHERE powder_name = ? AND lot_number = ? AND category = ?
            ''', (inspector, powder_name, lot_number, category))

            conn.commit()

            if not progress_updated:
                return jsonify({'success': False, 'message': '검사를 찾을 수 없습니다.'})

            return jsonify({'success': True, 'message': '검사자가 변경되었습니다.'})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: 검사 항목 저장
# ============================================

@app.route('/api/save-item', methods=['POST'])
def save_inspection_item():
    """검사 항목 저장 (단일 트랜잭션으로 통합)"""
    import time
    max_retries = 5
    retry_delay = 0.05  # 50ms

    last_error = None
    for attempt in range(max_retries):
        try:
            data = request.json
            powder_name = data.get('powderName')
            lot_number = data.get('lotNumber')
            item_name = data.get('itemName')
            values = data.get('values')

            print(f"저장 요청: {powder_name}, {lot_number}, {item_name}, {values}")

            # 특수 항목 처리
            if item_name == 'ApparentDensity':
                return save_apparent_density(powder_name, lot_number, values)
            elif item_name == 'Moisture':
                return save_moisture(powder_name, lot_number, values)
            elif item_name == 'Ash':
                return save_ash(powder_name, lot_number, values)

            # 일반 항목 처리
            valid_values = [float(v) for v in values if v != '' and v is not None]

            if not valid_values:
                return jsonify({'success': False, 'message': '유효한 측정값이 없습니다.'})

            average = sum(valid_values) / len(valid_values)
            average = round(average, 2)

            # 단일 트랜잭션으로 모든 작업 수행
            with closing(get_db()) as conn:
                # 규격 확인
                result = check_spec(powder_name, lot_number, item_name, average, conn)

                # 데이터 저장
                _do_save_to_result_table(powder_name, lot_number, item_name, values, average, result, conn)

                # 진행 상태 업데이트
                _do_update_progress(powder_name, lot_number, item_name, conn)

                # 모든 작업 성공 시 커밋
                conn.commit()

            return jsonify({'success': True, 'average': f'{average:.2f}', 'result': result})

        except Exception as e:
            if 'database is locked' in str(e).lower() and attempt < max_retries - 1:
                last_error = e
                print(f"재시도 {attempt + 1}/{max_retries}: {str(e)}")
                time.sleep(retry_delay * (2 ** attempt))
                continue
            else:
                print(f"오류: {str(e)}")
                return jsonify({'success': False, 'message': str(e)})

    if last_error:
        print(f"최종 오류: {str(last_error)}")
        return jsonify({'success': False, 'message': str(last_error)})

# ============================================
# API: 입도분석 저장
# ============================================

@app.route('/api/save-particle-size', methods=['POST'])
def save_particle_size():
    """입도분석 데이터 저장 (단일 트랜잭션으로 통합)"""
    import time
    max_retries = 5
    retry_delay = 0.05  # 50ms

    last_error = None
    for attempt in range(max_retries):
        try:
            data = request.json
            powder_name = data.get('powderName')
            lot_number = data.get('lotNumber')
            particle_data = data.get('particleData') or {}

            # DB에 정의된 모든 입도 규격을 조회하여, 모든 항목이 측정되어 있고
            # 규격 내에 있는지 확인해야 전체 PASS가 된다.
            with closing(get_db()) as conn:
                cursor = conn.cursor()
                cursor.execute('SELECT mesh_size, min_value, max_value FROM particle_size WHERE powder_name = ? ORDER BY id', (powder_name,))
                specs = [dict_from_row(r) for r in cursor.fetchall()]

            overall_result = 'PASS'

            # DB mesh_size 값을 프론트엔드 키로 변환하는 매핑
            mesh_size_to_key = {
                '+180 um': '180',
                '+150 um': '150',
                '+106 um': '106',
                '+75 um': '75',
                '+45 um': '45',
                '-45 um': '45M'
            }

            # 각 규격에 대해 측정값 존재 및 규격 만족 여부 확인
            for spec in specs:
                mesh_size = spec.get('mesh_size')
                key = mesh_size_to_key.get(mesh_size, mesh_size)
                entry = particle_data.get(key)

                if not entry:
                    # 측정값 누락 -> 불합격 처리
                    overall_result = 'FAIL'
                    particle_data[key] = {'val1': None, 'val2': None, 'avg': None, 'result': '불합격'}
                    continue

                avg = entry.get('avg')
                try:
                    if avg is None:
                        entry['result'] = '불합격'
                        overall_result = 'FAIL'
                    else:
                        avg_val = float(avg)
                        min_v = spec.get('min_value')
                        max_v = spec.get('max_value')
                        if (min_v is not None and avg_val < min_v) or (max_v is not None and avg_val > max_v):
                            entry['result'] = '불합격'
                            overall_result = 'FAIL'
                        else:
                            entry['result'] = '합격'
                except Exception:
                    entry['result'] = '불합격'
                    overall_result = 'FAIL'

            # 만약 DB에 규격이 하나도 없다면 기존 방식대로 전달된 데이터만으로 불합격 여부 확인
            if not specs:
                for mesh_id, mesh_data in particle_data.items():
                    if mesh_data.get('result') == '불합격':
                        overall_result = 'FAIL'

            # 단일 트랜잭션으로 모든 작업 수행
            with closing(get_db()) as conn:
                # 데이터 저장
                _do_save_particle_to_result_table(powder_name, lot_number, particle_data, overall_result, conn)

                # 진행 상태 업데이트
                _do_update_progress(powder_name, lot_number, 'ParticleSize', conn)

                # 모든 작업 성공 시 커밋
                conn.commit()

            return jsonify({'success': True, 'result': overall_result})

        except Exception as e:
            if 'database is locked' in str(e).lower() and attempt < max_retries - 1:
                last_error = e
                print(f"재시도 {attempt + 1}/{max_retries}: {str(e)}")
                time.sleep(retry_delay * (2 ** attempt))
                continue
            else:
                return jsonify({'success': False, 'message': str(e)})

    if last_error:
        return jsonify({'success': False, 'message': str(last_error)})

# ============================================
# API: 검사 결과 조회
# ============================================

@app.route('/api/search-results', methods=['GET'])
def search_inspection_results():
    """검사 결과 조회 (category, dateFrom, dateTo로 필터링 가능)"""
    try:
        category = request.args.get('category', '')
        powder_name = request.args.get('powderName', '')
        lot_number = request.args.get('lotNumber', '')
        date_from = request.args.get('dateFrom', '')
        date_to = request.args.get('dateTo', '')
        include_hidden = request.args.get('include_hidden', 'false').lower() == 'true'

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            query = 'SELECT * FROM inspection_result WHERE 1=1'
            params = []

            if category:
                query += ' AND category = ?'
                params.append(category)

            if powder_name:
                query += ' AND powder_name = ?'
                params.append(powder_name)

            if lot_number:
                query += ' AND lot_number = ?'
                params.append(lot_number)

            if date_from:
                query += ' AND inspection_time >= ?'
                params.append(date_from + ' 00:00:00')

            if date_to:
                query += ' AND inspection_time <= ?'
                params.append(date_to + ' 23:59:59')

            if not include_hidden:
                query += ' AND (is_hidden IS NULL OR is_hidden = 0)'

            query += ' ORDER BY inspection_time DESC'

            cursor.execute(query, params)
            results = [dict_from_row(row) for row in cursor.fetchall()]

            # 완료된 검사만 필터링
            results = [r for r in results if r['final_result'] in ['PASS', 'FAIL']]

            # 시간 필드 KST 변환
            for r in results:
                convert_times_in_dict(r)

            return jsonify({'success': True, 'data': results})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: 검사 결과 삭제
# ============================================

@app.route('/api/inspection-result/<powder_name>/<lot_number>', methods=['DELETE'])
def delete_inspection_result(powder_name, lot_number):
    """검사 결과 삭제"""
    try:
        data = request.get_json() or {}
        category = data.get('category', 'incoming')

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 검사 결과 확인
            cursor.execute('''
                SELECT * FROM inspection_result
                WHERE powder_name = ? AND lot_number = ? AND category = ?
            ''', (powder_name, lot_number, category))

            result = cursor.fetchone()

            if not result:
                return jsonify({'success': False, 'message': '검사 결과를 찾을 수 없습니다.'})

            # 검사 결과 삭제
            cursor.execute('''
                DELETE FROM inspection_result
                WHERE powder_name = ? AND lot_number = ? AND category = ?
            ''', (powder_name, lot_number, category))

            conn.commit()

            return jsonify({
                'success': True,
                'message': f'검사 결과가 삭제되었습니다. (분말: {powder_name}, LOT: {lot_number})'
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/inspection-result/<powder_name>/<lot_number>/hide', methods=['PATCH'])
def hide_inspection_result(powder_name, lot_number):
    """검사결과 숨기기/복원"""
    try:
        data = request.get_json() or {}
        hide = data.get('hide', True)
        hidden_by = data.get('hidden_by', '')
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            if hide:
                cursor.execute('''
                    UPDATE inspection_result SET is_hidden=1, hidden_at=datetime('now','localtime'), hidden_by=?
                    WHERE powder_name=? AND lot_number=?
                ''', (hidden_by, powder_name, lot_number))
            else:
                cursor.execute('''
                    UPDATE inspection_result SET is_hidden=0, hidden_at=NULL, hidden_by=NULL
                    WHERE powder_name=? AND lot_number=?
                ''', (powder_name, lot_number))
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: 검사 상세 조회
# ============================================

@app.route('/api/inspection-detail/<powder_name>/<lot_number>', methods=['GET'])
def get_inspection_detail(powder_name, lot_number):
    """검사 상세 정보 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()

            cursor.execute('''
                SELECT * FROM inspection_result
                WHERE powder_name = ? AND lot_number = ?
            ''', (powder_name, lot_number))

            row = cursor.fetchone()

            if not row:
                return jsonify({'success': False, 'message': '검사 결과를 찾을 수 없습니다.'})

            result = dict_from_row(row)

            # 분말 사양 추가
            cursor.execute('SELECT * FROM powder_spec WHERE powder_name = ?', (powder_name,))
            spec_row = cursor.fetchone()
            if spec_row:
                result['powderSpec'] = dict_from_row(spec_row)

            # 입도분석 규격 추가
            cursor.execute('''
                SELECT mesh_size, min_value, max_value
                FROM particle_size
                WHERE powder_name = ?
            ''', (powder_name,))
            particle_specs = [dict_from_row(r) for r in cursor.fetchall()]
            if particle_specs:
                result['particleSizeSpecs'] = particle_specs

            # 시간 필드 KST 변환
            convert_times_in_dict(result)

            return jsonify({'success': True, 'data': result})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: 검사 삭제
# ============================================

@app.route('/api/delete-inspection', methods=['POST'])
def delete_inspection():
    """검사 결과 삭제"""
    try:
        data = request.json
        powder_name = data.get('powderName')
        lot_number = data.get('lotNumber')

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 검사 결과 삭제
            cursor.execute('''
                DELETE FROM inspection_result
                WHERE powder_name = ? AND lot_number = ?
            ''', (powder_name, lot_number))

            # 진행중 검사 삭제
            cursor.execute('''
                DELETE FROM inspection_progress
                WHERE powder_name = ? AND lot_number = ?
            ''', (powder_name, lot_number))

            conn.commit()

            return jsonify({'success': True})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# 헬퍼 함수들
# ============================================

def save_apparent_density(powder_name, lot_number, values):
    """겉보기밀도 저장 (단일 트랜잭션으로 통합)"""
    import time
    max_retries = 5
    retry_delay = 0.05  # 50ms

    last_error = None
    for attempt in range(max_retries):
        try:
            # values: [emptyCup1, powderWeight1, emptyCup2, powderWeight2, emptyCup3, powderWeight3]
            densities = []
            for i in range(3):
                empty_cup = values[i * 2]
                powder_weight = values[i * 2 + 1]
                if empty_cup and powder_weight:
                    density = (float(powder_weight) - float(empty_cup)) / 25
                    densities.append(density)

            if not densities:
                return jsonify({'success': False, 'message': '유효한 측정값이 없습니다.'})

            average = round(sum(densities) / len(densities), 2)

            # 단일 트랜잭션으로 모든 작업 수행
            with closing(get_db()) as conn:
                result = check_spec(powder_name, lot_number, 'ApparentDensity', average, conn)
                _do_save_to_result_table(powder_name, lot_number, 'ApparentDensity', values, average, result, conn)
                _do_update_progress(powder_name, lot_number, 'ApparentDensity', conn)
                conn.commit()

            return jsonify({'success': True, 'average': f'{average:.2f}', 'result': result})

        except Exception as e:
            if 'database is locked' in str(e).lower() and attempt < max_retries - 1:
                last_error = e
                print(f"재시도 {attempt + 1}/{max_retries}: {str(e)}")
                time.sleep(retry_delay * (2 ** attempt))
                continue
            else:
                return jsonify({'success': False, 'message': str(e)})

    if last_error:
        return jsonify({'success': False, 'message': str(last_error)})

def save_moisture(powder_name, lot_number, values):
    """수분도 저장 (단일 트랜잭션으로 통합)"""
    import time
    max_retries = 5
    retry_delay = 0.05  # 50ms

    last_error = None
    for attempt in range(max_retries):
        try:
            # values: [initialWeight1, driedWeight1, initialWeight2, driedWeight2, initialWeight3, driedWeight3]
            moisture_values = []
            for i in range(3):
                initial = values[i * 2]
                dried = values[i * 2 + 1]
                if initial and dried:
                    moisture = ((float(initial) - float(dried)) / float(initial)) * 100
                    moisture_values.append(moisture)

            if not moisture_values:
                return jsonify({'success': False, 'message': '유효한 측정값이 없습니다.'})

            average = round(sum(moisture_values) / len(moisture_values), 2)

            # 단일 트랜잭션으로 모든 작업 수행
            with closing(get_db()) as conn:
                result = check_spec(powder_name, lot_number, 'Moisture', average, conn)
                _do_save_to_result_table(powder_name, lot_number, 'Moisture', values, average, result, conn)
                _do_update_progress(powder_name, lot_number, 'Moisture', conn)
                conn.commit()

            return jsonify({'success': True, 'average': f'{average:.2f}', 'result': result})

        except Exception as e:
            if 'database is locked' in str(e).lower() and attempt < max_retries - 1:
                last_error = e
                print(f"재시도 {attempt + 1}/{max_retries}: {str(e)}")
                time.sleep(retry_delay * (2 ** attempt))
                continue
            else:
                return jsonify({'success': False, 'message': str(e)})

    if last_error:
        return jsonify({'success': False, 'message': str(last_error)})

def save_ash(powder_name, lot_number, values):
    """회분도 저장 (단일 트랜잭션으로 통합)"""
    import time
    max_retries = 5
    retry_delay = 0.05  # 50ms

    last_error = None
    for attempt in range(max_retries):
        try:
            # values: [initialWeight1, ashWeight1, initialWeight2, ashWeight2, initialWeight3, ashWeight3]
            ash_values = []
            for i in range(3):
                initial = values[i * 2]
                ash = values[i * 2 + 1]
                if initial and ash:
                    ash_percent = ((float(initial) - float(ash)) / float(initial)) * 100
                    ash_values.append(ash_percent)

            if not ash_values:
                return jsonify({'success': False, 'message': '유효한 측정값이 없습니다.'})

            average = round(sum(ash_values) / len(ash_values), 2)

            # 단일 트랜잭션으로 모든 작업 수행
            with closing(get_db()) as conn:
                result = check_spec(powder_name, lot_number, 'Ash', average, conn)
                _do_save_to_result_table(powder_name, lot_number, 'Ash', values, average, result, conn)
                _do_update_progress(powder_name, lot_number, 'Ash', conn)
                conn.commit()

            return jsonify({'success': True, 'average': f'{average:.2f}', 'result': result})

        except Exception as e:
            if 'database is locked' in str(e).lower() and attempt < max_retries - 1:
                last_error = e
                print(f"재시도 {attempt + 1}/{max_retries}: {str(e)}")
                time.sleep(retry_delay * (2 ** attempt))
                continue
            else:
                return jsonify({'success': False, 'message': str(e)})

    if last_error:
        return jsonify({'success': False, 'message': str(last_error)})

def check_spec(powder_name, lot_number, item_name, average, conn=None):
    """규격 확인하여 PASS/FAIL 판정

    Args:
        powder_name: 분말명
        lot_number: LOT번호
        item_name: 검사 항목명
        average: 평균값
        conn: 기존 DB 연결 (없으면 새로 생성)
    """
    # 연결이 제공되지 않은 경우 새로 생성
    owns_connection = conn is None
    if owns_connection:
        conn = get_db()

    try:
        cursor = conn.cursor()

        # 검사 타입 확인
        cursor.execute('''
            SELECT inspection_type FROM inspection_progress
            WHERE powder_name = ? AND lot_number = ?
        ''', (powder_name, lot_number))
        progress_row = cursor.fetchone()

        if not progress_row:
            cursor.execute('''
                SELECT inspection_type FROM inspection_result
                WHERE powder_name = ? AND lot_number = ?
            ''', (powder_name, lot_number))
            progress_row = cursor.fetchone()

        if not progress_row:
            return 'PASS'

        inspection_type = progress_row[0]
        items = get_inspection_items(powder_name, inspection_type, conn)

        for item in items:
            if item['name'] == item_name:
                min_val = item.get('min')
                max_val = item.get('max')

                if min_val is not None and average < min_val:
                    return 'FAIL'
                if max_val is not None and average > max_val:
                    return 'FAIL'

        return 'PASS'
    finally:
        # 직접 생성한 연결만 닫기
        if owns_connection:
            conn.close()

def save_to_result_table(powder_name, lot_number, item_name, values, average, result):
    """검사 결과 테이블에 저장 (재시도 로직 포함)"""
    import time
    max_retries = 5
    retry_delay = 0.05  # 50ms

    last_error = None
    for attempt in range(max_retries):
        try:
            _do_save_to_result_table(powder_name, lot_number, item_name, values, average, result)
            return  # 성공하면 즉시 반환
        except Exception as e:
            if 'database is locked' in str(e).lower() and attempt < max_retries - 1:
                last_error = e
                time.sleep(retry_delay * (2 ** attempt))  # 지수 백오프
                continue
            else:
                raise  # 다른 오류거나 마지막 시도이면 그대로 throw

    # 모든 재시도 실패
    if last_error:
        raise last_error

def _do_save_to_result_table(powder_name, lot_number, item_name, values, average, result, conn=None):
    """실제 저장 로직

    Args:
        conn: 기존 DB 연결 (없으면 새로 생성)
    """
    # 연결이 제공되지 않은 경우 새로 생성
    owns_connection = conn is None
    if owns_connection:
        conn = get_db()

    try:
        cursor = conn.cursor()

        # 기존 행 확인
        cursor.execute('''
            SELECT id FROM inspection_result
            WHERE powder_name = ? AND lot_number = ?
        ''', (powder_name, lot_number))
        existing = cursor.fetchone()

        # 컬럼명 매핑
        column_map = {
            'FlowRate': ['flow_rate_1', 'flow_rate_2', 'flow_rate_3', 'flow_rate_avg', 'flow_rate_result'],
            'ApparentDensity': [
                'apparent_density_empty_cup_1', 'apparent_density_powder_weight_1', 'apparent_density_1',
                'apparent_density_empty_cup_2', 'apparent_density_powder_weight_2', 'apparent_density_2',
                'apparent_density_empty_cup_3', 'apparent_density_powder_weight_3', 'apparent_density_3',
                'apparent_density_avg', 'apparent_density_result'
            ],
            'CContent': ['c_content_1', 'c_content_2', 'c_content_3', 'c_content_avg', 'c_content_result'],
            'CuContent': ['cu_content_1', 'cu_content_2', 'cu_content_3', 'cu_content_avg', 'cu_content_result'],
            'Moisture': [
                'moisture_initial_weight_1', 'moisture_dried_weight_1', 'moisture_1',
                'moisture_initial_weight_2', 'moisture_dried_weight_2', 'moisture_2',
                'moisture_initial_weight_3', 'moisture_dried_weight_3', 'moisture_3',
                'moisture_avg', 'moisture_result'
            ],
            'Ash': [
                'ash_initial_weight_1', 'ash_ash_weight_1', 'ash_1',
                'ash_initial_weight_2', 'ash_ash_weight_2', 'ash_2',
                'ash_initial_weight_3', 'ash_ash_weight_3', 'ash_3',
                'ash_avg', 'ash_result'
            ],
            'SinterChangeRate': ['sinter_change_rate_1', 'sinter_change_rate_2', 'sinter_change_rate_3', 'sinter_change_rate_avg', 'sinter_change_rate_result'],
            'SinterStrength': ['sinter_strength_1', 'sinter_strength_2', 'sinter_strength_3', 'sinter_strength_avg', 'sinter_strength_result'],
            'FormingStrength': ['forming_strength_1', 'forming_strength_2', 'forming_strength_3', 'forming_strength_avg', 'forming_strength_result'],
            'FormingLoad': ['forming_load_1', 'forming_load_2', 'forming_load_3', 'forming_load_avg', 'forming_load_result']
        }

        if existing:
            # 기존 행 업데이트
            columns = column_map.get(item_name, [])

            if item_name in ['ApparentDensity', 'Moisture', 'Ash']:
                # 특수 항목 (계산값 포함)
                update_special_item(cursor, existing[0], item_name, columns, values, average, result)
            else:
                # 일반 항목
                update_parts = []
                update_values = []

                if len(values) >= 1 and values[0]:
                    update_parts.append(f'{columns[0]} = ?')
                    update_values.append(float(values[0]))
                if len(values) >= 2 and values[1]:
                    update_parts.append(f'{columns[1]} = ?')
                    update_values.append(float(values[1]))
                if len(values) >= 3 and values[2]:
                    update_parts.append(f'{columns[2]} = ?')
                    update_values.append(float(values[2]))

                update_parts.append(f'{columns[3]} = ?')
                update_values.append(average)

                update_parts.append(f'{columns[4]} = ?')
                update_values.append(result)

                update_values.append(existing[0])

                query = f"UPDATE inspection_result SET {', '.join(update_parts)} WHERE id = ?"
                cursor.execute(query, update_values)

        else:
            # 새 행 생성
            cursor.execute('''
                SELECT inspection_type, inspector, category, inspection_date FROM inspection_progress
                WHERE powder_name = ? AND lot_number = ?
            ''', (powder_name, lot_number))
            progress_data = cursor.fetchone()

            inspection_type = progress_data[0] if progress_data else '일상점검'
            inspector = progress_data[1] if progress_data else '미지정'
            category = progress_data[2] if progress_data and len(progress_data) > 2 else 'incoming'
            inspection_date = progress_data[3] if progress_data and len(progress_data) > 3 else None

            cursor.execute('''
                INSERT INTO inspection_result (powder_name, lot_number, inspection_type, inspector, category, inspection_date)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (powder_name, lot_number, inspection_type, inspector, category, inspection_date))

            new_id = cursor.lastrowid

            # 방금 생성한 행에 데이터 업데이트
            columns = column_map.get(item_name, [])

            if item_name in ['ApparentDensity', 'Moisture', 'Ash']:
                update_special_item(cursor, new_id, item_name, columns, values, average, result)
            else:
                update_parts = []
                update_values = []

                if len(values) >= 1 and values[0]:
                    update_parts.append(f'{columns[0]} = ?')
                    update_values.append(float(values[0]))
                if len(values) >= 2 and values[1]:
                    update_parts.append(f'{columns[1]} = ?')
                    update_values.append(float(values[1]))
                if len(values) >= 3 and values[2]:
                    update_parts.append(f'{columns[2]} = ?')
                    update_values.append(float(values[2]))

                update_parts.append(f'{columns[3]} = ?')
                update_values.append(average)

                update_parts.append(f'{columns[4]} = ?')
                update_values.append(result)

                update_values.append(new_id)

                query = f"UPDATE inspection_result SET {', '.join(update_parts)} WHERE id = ?"
                cursor.execute(query, update_values)

        # 연결을 직접 생성한 경우에만 커밋
        if owns_connection:
            conn.commit()
    finally:
        # 직접 생성한 연결만 닫기
        if owns_connection:
            conn.close()

def update_special_item(cursor, row_id, item_name, columns, values, average, result):
    """특수 항목 (겉보기밀도, 수분도, 회분도) 업데이트"""

    if item_name == 'ApparentDensity':
        # 겉보기밀도: 원본 데이터 + 계산값 저장
        update_parts = []
        update_values = []

        for i in range(3):
            empty_cup = values[i * 2] if i * 2 < len(values) else None
            powder_weight = values[i * 2 + 1] if i * 2 + 1 < len(values) else None

            if empty_cup:
                update_parts.append(f'{columns[i * 3]} = ?')
                update_values.append(float(empty_cup))

            if powder_weight:
                update_parts.append(f'{columns[i * 3 + 1]} = ?')
                update_values.append(float(powder_weight))

            if empty_cup and powder_weight:
                density = (float(powder_weight) - float(empty_cup)) / 25
                update_parts.append(f'{columns[i * 3 + 2]} = ?')
                update_values.append(round(density, 2))

        update_parts.append(f'{columns[9]} = ?')
        update_values.append(average)

        update_parts.append(f'{columns[10]} = ?')
        update_values.append(result)

        update_values.append(row_id)

        query = f"UPDATE inspection_result SET {', '.join(update_parts)} WHERE id = ?"
        cursor.execute(query, update_values)

    elif item_name in ['Moisture', 'Ash']:
        # 수분도/회분도: 원본 데이터 + 계산값 저장
        update_parts = []
        update_values = []

        for i in range(3):
            val1 = values[i * 2] if i * 2 < len(values) else None
            val2 = values[i * 2 + 1] if i * 2 + 1 < len(values) else None

            if val1:
                update_parts.append(f'{columns[i * 3]} = ?')
                update_values.append(float(val1))

            if val2:
                update_parts.append(f'{columns[i * 3 + 1]} = ?')
                update_values.append(float(val2))

            if val1 and val2:
                if item_name == 'Moisture':
                    calc_val = ((float(val1) - float(val2)) / float(val1)) * 100
                else:  # Ash
                    calc_val = (float(val2) / float(val1)) * 100

                update_parts.append(f'{columns[i * 3 + 2]} = ?')
                update_values.append(round(calc_val, 2))

        update_parts.append(f'{columns[9]} = ?')
        update_values.append(average)

        update_parts.append(f'{columns[10]} = ?')
        update_values.append(result)

        update_values.append(row_id)

        query = f"UPDATE inspection_result SET {', '.join(update_parts)} WHERE id = ?"
        cursor.execute(query, update_values)

def save_particle_to_result_table(powder_name, lot_number, particle_data, overall_result):
    """입도분석 결과 저장 (재시도 로직 포함)"""
    import time
    max_retries = 5
    retry_delay = 0.05  # 50ms

    last_error = None
    for attempt in range(max_retries):
        try:
            _do_save_particle_to_result_table(powder_name, lot_number, particle_data, overall_result)
            return  # 성공하면 즉시 반환
        except Exception as e:
            if 'database is locked' in str(e).lower() and attempt < max_retries - 1:
                last_error = e
                time.sleep(retry_delay * (2 ** attempt))  # 지수 백오프
                continue
            else:
                raise  # 다른 오류거나 마지막 시도이면 그대로 throw

    # 모든 재시도 실패
    if last_error:
        raise last_error

def _do_save_particle_to_result_table(powder_name, lot_number, particle_data, overall_result, conn=None):
    """실제 입도분석 저장 로직

    Args:
        conn: 기존 DB 연결 (없으면 새로 생성)
    """
    # 연결이 제공되지 않은 경우 새로 생성
    owns_connection = conn is None
    if owns_connection:
        conn = get_db()

    try:
        cursor = conn.cursor()

        # 기존 행 확인
        cursor.execute('''
            SELECT id FROM inspection_result
            WHERE powder_name = ? AND lot_number = ?
        ''', (powder_name, lot_number))
        existing = cursor.fetchone()

        mesh_mapping = {
            '180': 'particle_size_180',
            '150': 'particle_size_150',
            '106': 'particle_size_106',
            '75': 'particle_size_75',
            '45': 'particle_size_45',
            '45M': 'particle_size_45m'
        }

        update_parts = []
        update_values = []

        for mesh_id, prefix in mesh_mapping.items():
            data = particle_data.get(mesh_id)

            # Only update columns for meshes that were actually provided in the payload.
            # This prevents overwriting existing DB values with FAIL when the client
            # omitted a mesh key unintentionally.
            if not data:
                continue

            val1 = data.get('val1')
            val2 = data.get('val2')
            avg = data.get('avg')
            mesh_result = 'PASS' if data.get('result') == '합격' else 'FAIL'

            if val1 is not None and val1 != '':
                update_parts.append(f'{prefix}_1 = ?')
                update_values.append(float(val1))
            if val2 is not None and val2 != '':
                update_parts.append(f'{prefix}_2 = ?')
                update_values.append(float(val2))
            # avg may be '0' or '0.0' string; check against None and empty string
            if avg is not None and avg != '':
                try:
                    update_parts.append(f'{prefix}_avg = ?')
                    update_values.append(float(avg))
                except Exception:
                    # if parsing fails, skip avg
                    pass

            update_parts.append(f'{prefix}_result = ?')
            update_values.append(mesh_result)

        update_parts.append('particle_size_result = ?')
        update_values.append(overall_result)

        if existing:
            update_values.append(existing[0])
            query = f"UPDATE inspection_result SET {', '.join(update_parts)} WHERE id = ?"
            cursor.execute(query, update_values)
        else:
            cursor.execute('''
                SELECT inspection_type, inspector, category, inspection_date FROM inspection_progress
                WHERE powder_name = ? AND lot_number = ?
            ''', (powder_name, lot_number))
            progress_data = cursor.fetchone()

            inspection_type = progress_data[0] if progress_data else '일상점검'
            inspector = progress_data[1] if progress_data else '미지정'
            category = progress_data[2] if progress_data and len(progress_data) > 2 else 'incoming'
            inspection_date = progress_data[3] if progress_data and len(progress_data) > 3 else None

            cursor.execute('''
                INSERT INTO inspection_result (powder_name, lot_number, inspection_type, inspector, category, inspection_date)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (powder_name, lot_number, inspection_type, inspector, category, inspection_date))

            new_id = cursor.lastrowid
            update_values.append(new_id)

            query = f"UPDATE inspection_result SET {', '.join(update_parts)} WHERE id = ?"
            cursor.execute(query, update_values)

        # 연결을 직접 생성한 경우에만 커밋
        if owns_connection:
            conn.commit()
    finally:
        # 직접 생성한 연결만 닫기
        if owns_connection:
            conn.close()

def update_progress(powder_name, lot_number, item_name):
    """진행중 검사 업데이트 (재시도 로직 포함)"""
    import time
    max_retries = 5
    retry_delay = 0.05  # 50ms

    last_error = None
    for attempt in range(max_retries):
        try:
            _do_update_progress(powder_name, lot_number, item_name)
            return
        except Exception as e:
            if 'database is locked' in str(e).lower() and attempt < max_retries - 1:
                last_error = e
                time.sleep(retry_delay * (2 ** attempt))
                continue
            else:
                raise

    if last_error:
        raise last_error

def _do_update_progress(powder_name, lot_number, item_name, conn=None):
    """실제 진행 업데이트 로직

    Args:
        conn: 기존 DB 연결 (없으면 새로 생성)
    """
    # 연결이 제공되지 않은 경우 새로 생성
    owns_connection = conn is None
    if owns_connection:
        conn = get_db()

    try:
        cursor = conn.cursor()

        cursor.execute('''
            SELECT completed_items, total_items FROM inspection_progress
            WHERE powder_name = ? AND lot_number = ?
        ''', (powder_name, lot_number))
        progress_row = cursor.fetchone()

        if not progress_row:
            # 완료된 검사인 경우 최종 결과만 업데이트
            update_final_result(powder_name, lot_number, conn)
            return

        completed_items = json.loads(progress_row[0] or '[]')
        total_items = json.loads(progress_row[1] or '[]')

        if item_name not in completed_items:
            completed_items.append(item_name)

        progress = f'{len(completed_items)}/{len(total_items)}'

        cursor.execute('''
            UPDATE inspection_progress
            SET completed_items = ?, progress = ?
            WHERE powder_name = ? AND lot_number = ?
        ''', (json.dumps(completed_items), progress, powder_name, lot_number))

        # 모든 항목 완료 시 진행중 검사에서 제거
        if len(completed_items) == len(total_items):
            print(f"[DEBUG] 모든 항목 완료: {powder_name} {lot_number}, completed={completed_items}, total={total_items}")
            cursor.execute('''
                DELETE FROM inspection_progress
                WHERE powder_name = ? AND lot_number = ?
            ''', (powder_name, lot_number))

            update_final_result(powder_name, lot_number, conn)
            print(f"[DEBUG] update_final_result 호출 완료")

        # 연결을 직접 생성한 경우에만 커밋
        if owns_connection:
            conn.commit()
    finally:
        # 직접 생성한 연결만 닫기
        if owns_connection:
            conn.close()

def update_final_result(powder_name, lot_number, conn=None):
    """최종 결과 업데이트

    Args:
        powder_name: 분말명
        lot_number: LOT번호
        conn: 기존 DB 연결 (없으면 새로 생성)
    """
    # 연결이 제공되지 않은 경우 새로 생성
    owns_connection = conn is None
    if owns_connection:
        conn = get_db()

    try:
        cursor = conn.cursor()

        # powder_spec에서 활성화된 검사 항목 확인
        cursor.execute('''
            SELECT flow_rate_type, apparent_density_type, c_content_type, cu_content_type,
                   moisture_type, ash_type, sinter_change_rate_type, sinter_strength_type,
                   forming_strength_type, forming_load_type, particle_size_type, category
            FROM powder_spec
            WHERE powder_name = ?
        ''', (powder_name,))
        spec_row = cursor.fetchone()

        if not spec_row:
            return

        cursor.execute('''
            SELECT * FROM inspection_result
            WHERE powder_name = ? AND lot_number = ?
        ''', (powder_name, lot_number))
        result_row = cursor.fetchone()

        if not result_row:
            print(f"[DEBUG] {powder_name} {lot_number}: inspection_result 행 없음")
            return

        result_data = dict_from_row(result_row)

        # 검사 유형에 따라 필수 항목 결정
        # 일상점검: '일상' 항목만 필수 / 정기점검: '일상'+'정기' 항목 모두 필수
        inspection_type = result_data.get('inspection_type', '일상점검')

        spec_type_result_pairs = [
            (spec_row[0], 'flow_rate_result'),
            (spec_row[1], 'apparent_density_result'),
            (spec_row[2], 'c_content_result'),
            (spec_row[3], 'cu_content_result'),
            (spec_row[4], 'moisture_result'),
            (spec_row[5], 'ash_result'),
            (spec_row[6], 'sinter_change_rate_result'),
            (spec_row[7], 'sinter_strength_result'),
            (spec_row[8], 'forming_strength_result'),
            (spec_row[9], 'forming_load_result'),
            (spec_row[10], 'particle_size_result'),
        ]

        required_result_columns = []
        for item_type, result_col in spec_type_result_pairs:
            if not item_type or item_type == '비활성':
                continue
            if inspection_type == '일상점검' and item_type != '일상':
                continue
            required_result_columns.append(result_col)

        print(f"[DEBUG] update_final_result: {powder_name} {lot_number}, inspection_type={inspection_type}, required_columns={required_result_columns}")

        # 모든 필수 _result 컬럼이 NULL이 아닌지 확인
        for col in required_result_columns:
            col_value = result_data.get(col)
            print(f"[DEBUG] {powder_name} {lot_number}: {col} = {col_value}")
            if col_value is None:
                # 하나라도 NULL이면 final_result를 설정하지 않음
                print(f"[DEBUG] {powder_name} {lot_number}: {col}이 NULL이므로 final_result 설정 안 함")
                return

        # 모든 필수 항목이 완료되었을 때만 최종 결과 판정
        final_result = 'PASS'
        for col in required_result_columns:
            if result_data.get(col) == 'FAIL':
                final_result = 'FAIL'
                break

        # Millsheet 파일 존재 시 경로도 함께 저장
        sp = safe_name(powder_name)
        sl = safe_name(lot_number)
        ms_path = os.path.join(MILLSHEET_DIR, sp, f"{sp}_{sl}.pdf")
        ms_rel  = f"millsheets/{sp}/{sp}_{sl}.pdf" if os.path.exists(ms_path) else None
        if ms_rel:
            cursor.execute('''
                UPDATE inspection_result
                SET final_result = ?, millsheet_path = ?
                WHERE powder_name = ? AND lot_number = ?
            ''', (final_result, ms_rel, powder_name, lot_number))
        else:
            cursor.execute('''
                UPDATE inspection_result
                SET final_result = ?
                WHERE powder_name = ? AND lot_number = ?
            ''', (final_result, powder_name, lot_number))

        print(f"[DEBUG] {powder_name} {lot_number}: final_result = {final_result} 설정 완료")

        # 연결을 직접 생성한 경우에만 커밋
        if owns_connection:
            conn.commit()
    finally:
        # 직접 생성한 연결만 닫기
        if owns_connection:
            conn.close()

# ============================================
# 관리자 API
# ============================================

# --------------------------------------------
# 분말 목록 조회 (카테고리별)
# --------------------------------------------

@app.route('/api/powders', methods=['GET'])
def get_powders_by_category():
    """카테고리별 분말 목록 조회"""
    try:
        category = request.args.get('category')

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            if category:
                cursor.execute('SELECT powder_name, category FROM powder_spec WHERE category = ? ORDER BY powder_name', (category,))
            else:
                cursor.execute('SELECT powder_name, category FROM powder_spec ORDER BY powder_name')

            powders = [{'powder_name': row[0], 'category': row[1]} for row in cursor.fetchall()]
            return jsonify({'success': True, 'powders': powders})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# --------------------------------------------
# 분말 사양 관리
# --------------------------------------------

@app.route('/api/admin/powder-spec', methods=['GET'])
def admin_get_all_powder_specs():
    """모든 분말 사양 조회 (관리자용)"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM powder_spec ORDER BY powder_name')
            specs = [dict_from_row(row) for row in cursor.fetchall()]
            return jsonify({'success': True, 'data': specs})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/powder-spec', methods=['POST'])
def admin_add_powder_spec():
    """분말 사양 추가"""
    try:
        data = request.json

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 중복 확인
            cursor.execute('SELECT id FROM powder_spec WHERE powder_name = ?', (data['powder_name'],))
            if cursor.fetchone():
                return jsonify({'success': False, 'message': '이미 존재하는 분말명입니다.'})

            # 삽입
            cursor.execute('''
                INSERT INTO powder_spec (
                    powder_name,
                    flow_rate_min, flow_rate_max, flow_rate_type,
                    apparent_density_min, apparent_density_max, apparent_density_type,
                    c_content_min, c_content_max, c_content_type,
                    cu_content_min, cu_content_max, cu_content_type,
                    moisture_min, moisture_max, moisture_type,
                    ash_min, ash_max, ash_type,
                    sinter_change_rate_min, sinter_change_rate_max, sinter_change_rate_type,
                    sinter_strength_min, sinter_strength_max, sinter_strength_type,
                    forming_strength_min, forming_strength_max, forming_strength_type,
                    forming_load_min, forming_load_max, forming_load_type,
                    particle_size_type,
                    category
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                data.get('powder_name'),
                data.get('flow_rate_min'), data.get('flow_rate_max'), data.get('flow_rate_type'),
                data.get('apparent_density_min'), data.get('apparent_density_max'), data.get('apparent_density_type'),
                data.get('c_content_min'), data.get('c_content_max'), data.get('c_content_type'),
                data.get('cu_content_min'), data.get('cu_content_max'), data.get('cu_content_type'),
                data.get('moisture_min'), data.get('moisture_max'), data.get('moisture_type'),
                data.get('ash_min'), data.get('ash_max'), data.get('ash_type'),
                data.get('sinter_change_rate_min'), data.get('sinter_change_rate_max'), data.get('sinter_change_rate_type'),
                data.get('sinter_strength_min'), data.get('sinter_strength_max'), data.get('sinter_strength_type'),
                data.get('forming_strength_min'), data.get('forming_strength_max'), data.get('forming_strength_type'),
                data.get('forming_load_min'), data.get('forming_load_max'), data.get('forming_load_type'),
                data.get('particle_size_type'),
                data.get('category', 'incoming')
            ))

            conn.commit()
            return jsonify({'success': True})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/powder-spec/<int:spec_id>', methods=['PUT'])
def admin_update_powder_spec(spec_id):
    """분말 사양 수정"""
    try:
        data = request.json

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            cursor.execute('''
                UPDATE powder_spec SET
                    powder_name = ?,
                    flow_rate_min = ?, flow_rate_max = ?, flow_rate_type = ?,
                    apparent_density_min = ?, apparent_density_max = ?, apparent_density_type = ?,
                    c_content_min = ?, c_content_max = ?, c_content_type = ?,
                    cu_content_min = ?, cu_content_max = ?, cu_content_type = ?,
                    moisture_min = ?, moisture_max = ?, moisture_type = ?,
                    ash_min = ?, ash_max = ?, ash_type = ?,
                    sinter_change_rate_min = ?, sinter_change_rate_max = ?, sinter_change_rate_type = ?,
                    sinter_strength_min = ?, sinter_strength_max = ?, sinter_strength_type = ?,
                    forming_strength_min = ?, forming_strength_max = ?, forming_strength_type = ?,
                    forming_load_min = ?, forming_load_max = ?, forming_load_type = ?,
                    particle_size_type = ?,
                    category = ?,
                    scan_lot_position = ?
                WHERE id = ?
            ''', (
                data.get('powder_name'),
                data.get('flow_rate_min'), data.get('flow_rate_max'), data.get('flow_rate_type'),
                data.get('apparent_density_min'), data.get('apparent_density_max'), data.get('apparent_density_type'),
                data.get('c_content_min'), data.get('c_content_max'), data.get('c_content_type'),
                data.get('cu_content_min'), data.get('cu_content_max'), data.get('cu_content_type'),
                data.get('moisture_min'), data.get('moisture_max'), data.get('moisture_type'),
                data.get('ash_min'), data.get('ash_max'), data.get('ash_type'),
                data.get('sinter_change_rate_min'), data.get('sinter_change_rate_max'), data.get('sinter_change_rate_type'),
                data.get('sinter_strength_min'), data.get('sinter_strength_max'), data.get('sinter_strength_type'),
                data.get('forming_strength_min'), data.get('forming_strength_max'), data.get('forming_strength_type'),
                data.get('forming_load_min'), data.get('forming_load_max'), data.get('forming_load_type'),
                data.get('particle_size_type'),
                data.get('category', 'incoming'),
                int(data.get('scan_lot_position', 0) or 0),
                spec_id
            ))

            conn.commit()
            return jsonify({'success': True})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/powder-spec/<int:spec_id>', methods=['DELETE'])
def admin_delete_powder_spec(spec_id):
    """분말 사양 삭제"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM powder_spec WHERE id = ?', (spec_id,))
            conn.commit()
            return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# --------------------------------------------
# 입도분석 규격 관리
# --------------------------------------------

@app.route('/api/admin/particle-size', methods=['GET'])
def admin_get_all_particle_sizes():
    """모든 입도분석 규격 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM particle_size ORDER BY powder_name, id')
            specs = [dict_from_row(row) for row in cursor.fetchall()]
            return jsonify({'success': True, 'data': specs})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/particle-size/<powder_name>', methods=['GET'])
def admin_get_particle_size_by_powder(powder_name):
    """특정 분말의 입도분석 규격 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM particle_size WHERE powder_name = ? ORDER BY id', (powder_name,))
            specs = [dict_from_row(row) for row in cursor.fetchall()]
            return jsonify({'success': True, 'data': specs})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/particle-size', methods=['POST'])
def admin_add_particle_size():
    """입도분석 규격 추가"""
    try:
        data = request.json

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 중복 확인
            cursor.execute('''
                SELECT id FROM particle_size
                WHERE powder_name = ? AND mesh_size = ?
            ''', (data['powder_name'], data['mesh_size']))

            if cursor.fetchone():
                return jsonify({'success': False, 'message': '이미 존재하는 규격입니다.'})

            cursor.execute('''
                INSERT INTO particle_size (powder_name, mesh_size, min_value, max_value)
                VALUES (?, ?, ?, ?)
            ''', (data['powder_name'], data['mesh_size'], data['min_value'], data['max_value']))

            conn.commit()
            return jsonify({'success': True})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/particle-size/<int:spec_id>', methods=['PUT'])
def admin_update_particle_size(spec_id):
    """입도분석 규격 수정"""
    try:
        data = request.json

        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE particle_size SET
                    powder_name = ?, mesh_size = ?, min_value = ?, max_value = ?
                WHERE id = ?
            ''', (data['powder_name'], data['mesh_size'], data['min_value'], data['max_value'], spec_id))

            conn.commit()
            return jsonify({'success': True})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/particle-size/<int:spec_id>', methods=['DELETE'])
def admin_delete_particle_size(spec_id):
    """입도분석 규격 삭제"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM particle_size WHERE id = ?', (spec_id,))
            conn.commit()
            return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/particle-size/bulk', methods=['POST'])
def admin_bulk_save_particle_size():
    """입도분석 규격 일괄 저장"""
    try:
        data = request.json
        powder_name = data.get('powder_name')
        specs = data.get('specs', [])

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 기존 입도분석 규격 삭제
            cursor.execute('DELETE FROM particle_size WHERE powder_name = ?', (powder_name,))

            # 새 규격 추가
            for spec in specs:
                cursor.execute('''
                    INSERT INTO particle_size (powder_name, mesh_size, min_value, max_value)
                    VALUES (?, ?, ?, ?)
                ''', (spec['powder_name'], spec['mesh_size'], spec['min_value'], spec['max_value']))

            conn.commit()
            return jsonify({'success': True})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# --------------------------------------------
# 검사자 관리
# --------------------------------------------

@app.route('/api/admin/inspector', methods=['GET'])
def admin_get_all_inspectors():
    """모든 검사자 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM inspector ORDER BY name')
            inspectors = [dict_from_row(row) for row in cursor.fetchall()]
            return jsonify({'success': True, 'data': inspectors})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/inspector', methods=['POST'])
def admin_add_inspector():
    """검사자 추가"""
    try:
        data = request.json
        name = data.get('name', '').strip()

        if not name:
            return jsonify({'success': False, 'message': '검사자 이름을 입력하세요.'})

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 중복 확인
            cursor.execute('SELECT id FROM inspector WHERE name = ?', (name,))
            if cursor.fetchone():
                return jsonify({'success': False, 'message': '이미 존재하는 검사자입니다.'})

            cursor.execute('INSERT INTO inspector (name) VALUES (?)', (name,))
            conn.commit()
            return jsonify({'success': True})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/inspector/<int:inspector_id>', methods=['DELETE'])
def admin_delete_inspector(inspector_id):
    """검사자 삭제"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM inspector WHERE id = ?', (inspector_id,))
            conn.commit()
            return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: 작업자 관리 (Operator Management)
# ============================================

@app.route('/api/operator-list', methods=['GET'])
def get_operator_list():
    """작업자 목록 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT name FROM operator ORDER BY name')
            operators = [row[0] for row in cursor.fetchall()]
            return jsonify({'success': True, 'data': operators})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/operator', methods=['GET'])
def admin_get_all_operators():
    """모든 작업자 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM operator ORDER BY name')
            operators = [dict_from_row(row) for row in cursor.fetchall()]
            return jsonify({'success': True, 'data': operators})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/operator', methods=['POST'])
def admin_add_operator():
    """작업자 추가"""
    try:
        data = request.json
        name = data.get('name', '').strip()

        if not name:
            return jsonify({'success': False, 'message': '작업자 이름을 입력하세요.'})

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 중복 확인
            cursor.execute('SELECT id FROM operator WHERE name = ?', (name,))
            if cursor.fetchone():
                return jsonify({'success': False, 'message': '이미 존재하는 작업자입니다.'})

            cursor.execute('INSERT INTO operator (name) VALUES (?)', (name,))
            conn.commit()
            return jsonify({'success': True})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/operator/<int:operator_id>', methods=['DELETE'])
def admin_delete_operator(operator_id):
    """작업자 삭제"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM operator WHERE id = ?', (operator_id,))
            conn.commit()
            return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: Recipe(배합 규격서) 관리
# ============================================

@app.route('/api/admin/recipes', methods=['GET'])
def admin_get_recipes():
    """Recipe 목록 조회 (제품별 그룹핑)"""
    try:
        product_name = request.args.get('product_name', None)

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            if product_name:
                # 특정 제품의 Recipe만 조회
                cursor.execute('''
                    SELECT * FROM recipe
                    WHERE product_name = ? AND is_active = 1
                    ORDER BY id
                ''', (product_name,))
            else:
                # 모든 Recipe 조회
                cursor.execute('''
                    SELECT * FROM recipe
                    WHERE is_active = 1
                    ORDER BY product_name, id
                ''')

            recipes = [dict_from_row(row) for row in cursor.fetchall()]

            # 제품별 그룹핑
            products = {}
            for recipe in recipes:
                pname = recipe['product_name']
                if pname not in products:
                    products[pname] = {
                        'product_name': pname,
                        'product_code': recipe['product_code'],
                        'rev': '',
                        'spec_file_name': '',
                        'recipes': []
                    }
                products[pname]['recipes'].append(recipe)

            # product_spec 테이블에서 REV/규격서 정보 가져오기
            for pname in products:
                cursor.execute(
                    'SELECT rev, spec_file_name FROM product_spec WHERE product_name = ?',
                    (pname,)
                )
                spec_row = cursor.fetchone()
                if spec_row:
                    products[pname]['rev'] = spec_row['rev'] or ''
                    products[pname]['spec_file_name'] = spec_row['spec_file_name'] or ''

            return jsonify({
                'success': True,
                'data': list(products.values()),
                'total_products': len(products),
                'total_recipes': len(recipes)
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/recipe', methods=['POST'])
def admin_add_recipe():
    """Recipe 추가"""
    try:
        data = request.json

        required_fields = ['product_name', 'powder_name', 'ratio']
        if not all(field in data for field in required_fields):
            return jsonify({'success': False, 'message': '필수 항목이 누락되었습니다.'})

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            cursor.execute('''
                INSERT INTO recipe (
                    product_name, product_code, powder_name, powder_category,
                    ratio, target_weight, tolerance_minus, tolerance_plus, is_main, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                data['product_name'],
                data.get('product_code', ''),
                data['powder_name'],
                data.get('powder_category', 'incoming'),
                data['ratio'],
                data.get('target_weight', None),
                data.get('tolerance_minus', 5),
                data.get('tolerance_plus', 5),
                1 if data.get('is_main', False) else 0,
                data.get('created_by', '관리자')
            ))

            conn.commit()
            return jsonify({'success': True, 'recipe_id': cursor.lastrowid})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/recipe/<int:recipe_id>', methods=['PUT'])
def admin_update_recipe(recipe_id):
    """Recipe 수정"""
    try:
        data = request.json

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            cursor.execute('''
                UPDATE recipe SET
                    product_name = ?,
                    product_code = ?,
                    powder_name = ?,
                    powder_category = ?,
                    ratio = ?,
                    target_weight = ?,
                    tolerance_minus = ?,
                    tolerance_plus = ?,
                    is_main = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (
                data['product_name'],
                data.get('product_code', ''),
                data['powder_name'],
                data.get('powder_category', 'incoming'),
                data['ratio'],
                data.get('target_weight', None),
                data.get('tolerance_minus', 5),
                data.get('tolerance_plus', 5),
                1 if data.get('is_main', False) else 0,
                recipe_id
            ))

            conn.commit()
            return jsonify({'success': True})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/recipe/<int:recipe_id>', methods=['DELETE'])
def admin_delete_recipe(recipe_id):
    """Recipe 삭제 (소프트 삭제)"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 실제 삭제 대신 is_active = 0으로 변경
            cursor.execute('''
                UPDATE recipe SET is_active = 0, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (recipe_id,))

            conn.commit()
            return jsonify({'success': True})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/recipe/product/<product_name>', methods=['DELETE'])
def admin_delete_product_recipes(product_name):
    """제품의 모든 Recipe 삭제 (소프트 삭제)"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()

            cursor.execute('''
                UPDATE recipe SET is_active = 0, updated_at = CURRENT_TIMESTAMP
                WHERE product_name = ?
            ''', (product_name,))

            conn.commit()
            return jsonify({'success': True})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: 제품 규격서/REV 관리
# ============================================

def ensure_product_spec_table():
    """product_spec 테이블이 없으면 생성 (마이그레이션)"""
    with closing(get_db()) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS product_spec (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_name VARCHAR(100) NOT NULL UNIQUE,
                rev VARCHAR(20) DEFAULT '',
                spec_file_name VARCHAR(255) DEFAULT '',
                spec_file_path VARCHAR(500) DEFAULT '',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()

def ensure_recipe_tolerance_columns():
    """recipe 테이블에 tolerance_minus, tolerance_plus 컬럼 추가 (마이그레이션)"""
    with closing(get_db()) as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(recipe)")
        columns = [col[1] for col in cursor.fetchall()]
        if 'tolerance_minus' not in columns:
            cursor.execute('ALTER TABLE recipe ADD COLUMN tolerance_minus DECIMAL(10,2) DEFAULT 5')
            cursor.execute('ALTER TABLE recipe ADD COLUMN tolerance_plus DECIMAL(10,2) DEFAULT 5')
            # 기존 데이터 마이그레이션: tolerance_percent 값이 있으면 그대로 복사
            if 'tolerance_percent' in columns:
                cursor.execute('UPDATE recipe SET tolerance_minus = tolerance_percent, tolerance_plus = tolerance_percent WHERE tolerance_percent IS NOT NULL')
            conn.commit()

def ensure_blending_order_hidden_columns():
    """blending_order 테이블에 is_hidden 관련 컬럼 추가 (마이그레이션)"""
    with closing(get_db()) as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(blending_order)")
        columns = [col[1] for col in cursor.fetchall()]
        if 'is_hidden' not in columns:
            cursor.execute('ALTER TABLE blending_order ADD COLUMN is_hidden INTEGER DEFAULT 0')
            cursor.execute('ALTER TABLE blending_order ADD COLUMN hidden_at TIMESTAMP')
            cursor.execute('ALTER TABLE blending_order ADD COLUMN hidden_by VARCHAR(50)')
            conn.commit()

def ensure_inspection_result_hidden_columns():
    """inspection_result 테이블에 is_hidden 관련 컬럼 추가 (마이그레이션)"""
    with closing(get_db()) as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(inspection_result)")
        columns = [col[1] for col in cursor.fetchall()]
        if 'is_hidden' not in columns:
            cursor.execute('ALTER TABLE inspection_result ADD COLUMN is_hidden INTEGER DEFAULT 0')
            cursor.execute('ALTER TABLE inspection_result ADD COLUMN hidden_at TIMESTAMP')
            cursor.execute('ALTER TABLE inspection_result ADD COLUMN hidden_by VARCHAR(50)')
            conn.commit()

def ensure_blending_work_hidden_columns():
    """blending_work 테이블에 is_hidden 관련 컬럼 추가 (마이그레이션)"""
    with closing(get_db()) as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(blending_work)")
        columns = [col[1] for col in cursor.fetchall()]
        if 'is_hidden' not in columns:
            cursor.execute('ALTER TABLE blending_work ADD COLUMN is_hidden INTEGER DEFAULT 0')
            cursor.execute('ALTER TABLE blending_work ADD COLUMN hidden_at TIMESTAMP')
            cursor.execute('ALTER TABLE blending_work ADD COLUMN hidden_by VARCHAR(50)')
            conn.commit()

# 서버 시작 시 테이블 보장
ensure_product_spec_table()
ensure_recipe_tolerance_columns()
ensure_blending_order_hidden_columns()
ensure_inspection_result_hidden_columns()
ensure_blending_work_hidden_columns()

def ensure_powder_spec_scan_lot_column():
    """powder_spec 테이블에 scan_lot_position 컬럼 추가 (마이그레이션)"""
    with closing(get_db()) as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(powder_spec)")
        columns = [col[1] for col in cursor.fetchall()]
        if 'scan_lot_position' not in columns:
            cursor.execute('ALTER TABLE powder_spec ADD COLUMN scan_lot_position INTEGER DEFAULT 0')
            conn.commit()

ensure_powder_spec_scan_lot_column()

# ---------------------------------------------------------------------------
# Millsheet 저장 설정
# ---------------------------------------------------------------------------
MILLSHEET_DIR = os.path.join(os.path.dirname(__file__), 'uploads', 'millsheets')

def safe_name(name):
    """파일/폴더명에 사용할 수 없는 문자를 _로 치환"""
    return re.sub(r'[^\w.\-]', '_', name)

def ensure_millsheet_path_column():
    """inspection_result 테이블에 millsheet_path 컬럼 추가 (마이그레이션)"""
    with closing(get_db()) as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(inspection_result)")
        cols = [row[1] for row in cursor.fetchall()]
        if 'millsheet_path' not in cols:
            cursor.execute('ALTER TABLE inspection_result ADD COLUMN millsheet_path VARCHAR(500)')
        if 'drive_file_id' not in cols:
            cursor.execute('ALTER TABLE inspection_result ADD COLUMN drive_file_id VARCHAR(200)')
        conn.commit()

ensure_millsheet_path_column()


def ensure_bot_registered_table():
    """Bot 등록 이력 테이블 생성 (DriveFileId 기준 중복 방지용)"""
    with closing(get_db()) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS bot_registered (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                drive_file_id TEXT UNIQUE NOT NULL,
                powder_name TEXT,
                lot_number TEXT,
                registered_at TIMESTAMP DEFAULT (datetime('now','localtime'))
            )
        ''')
        conn.commit()

ensure_bot_registered_table()

# ---------------------------------------------------------------------------
# Millsheet 업로드 API
# ---------------------------------------------------------------------------

@app.route('/api/millsheet/upload', methods=['POST'])
def upload_millsheet():
    powder_name = request.form.get('powder_name', '').strip()
    lot_number  = request.form.get('lot_number', '').strip()
    overwrite   = request.form.get('overwrite', 'false').lower() == 'true'
    try:
        page_numbers = json.loads(request.form.get('page_numbers', '[]'))
    except Exception:
        return jsonify({'success': False, 'message': '페이지 번호 형식이 잘못되었습니다.'})

    if not powder_name or not lot_number:
        return jsonify({'success': False, 'message': '분말명과 LOT번호를 입력하세요.'})
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': '파일을 선택하세요.'})
    if not page_numbers:
        return jsonify({'success': False, 'message': '저장할 페이지를 선택하세요.'})

    pdf_file = request.files['file']
    if not pdf_file.filename.lower().endswith('.pdf'):
        return jsonify({'success': False, 'message': 'PDF 파일만 업로드 가능합니다.'})

    sp = safe_name(powder_name)
    sl = safe_name(lot_number)
    folder   = os.path.join(MILLSHEET_DIR, sp)
    filename = f"{sp}_{sl}.pdf"
    filepath = os.path.join(folder, filename)

    if os.path.exists(filepath) and not overwrite:
        return jsonify({'success': False, 'exists': True,
                        'message': '기존 파일이 있습니다. 교체하시겠습니까?'})

    os.makedirs(folder, exist_ok=True)
    try:
        pdf_bytes = pdf_file.read()
        src  = fitz.open(stream=pdf_bytes, filetype='pdf')
        dest = fitz.open()
        for p in sorted(page_numbers):
            idx = p - 1
            if 0 <= idx < len(src):
                dest.insert_pdf(src, from_page=idx, to_page=idx)
        dest.save(filepath)
        dest.close()
        src.close()
    except Exception as e:
        return jsonify({'success': False, 'message': f'PDF 처리 오류: {str(e)}'})

    rel_path = f"millsheets/{sp}/{filename}"
    return jsonify({'success': True, 'path': rel_path})


@app.route('/api/millsheet/<powder_name>/<lot_number>', methods=['GET'])
def serve_millsheet(powder_name, lot_number):
    sp = safe_name(powder_name)
    sl = safe_name(lot_number)
    filepath = os.path.join(MILLSHEET_DIR, sp, f"{sp}_{sl}.pdf")
    if not os.path.exists(filepath):
        return jsonify({'success': False, 'message': '파일을 찾을 수 없습니다.'}), 404
    return send_file(filepath, mimetype='application/pdf',
                     download_name=f"{sp}_{sl}.pdf", as_attachment=False)


@app.route('/api/admin/product-spec/rev', methods=['POST'])
def update_product_rev():
    """제품 REV 업데이트"""
    try:
        data = request.get_json()
        product_name = data.get('product_name', '')
        rev = data.get('rev', '')

        if not product_name:
            return jsonify({'success': False, 'message': '제품명이 필요합니다.'})

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # UPSERT: 있으면 업데이트, 없으면 삽입
            cursor.execute('SELECT id FROM product_spec WHERE product_name = ?', (product_name,))
            existing = cursor.fetchone()

            if existing:
                cursor.execute('''
                    UPDATE product_spec SET rev = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE product_name = ?
                ''', (rev, product_name))
            else:
                cursor.execute('''
                    INSERT INTO product_spec (product_name, rev) VALUES (?, ?)
                ''', (product_name, rev))

            conn.commit()
            return jsonify({'success': True, 'message': f'REV가 "{rev}"로 저장되었습니다.'})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/product-spec/upload', methods=['POST'])
def upload_product_spec():
    """제품 규격서 PDF 업로드"""
    try:
        product_name = request.form.get('product_name', '')
        if not product_name:
            return jsonify({'success': False, 'message': '제품명이 필요합니다.'})

        if 'file' not in request.files:
            return jsonify({'success': False, 'message': '파일이 없습니다.'})

        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'message': '파일이 선택되지 않았습니다.'})

        # PDF 파일만 허용
        if not file.filename.lower().endswith('.pdf'):
            return jsonify({'success': False, 'message': 'PDF 파일만 업로드 가능합니다.'})

        # 안전한 파일명 생성
        from werkzeug.utils import secure_filename
        safe_product = secure_filename(product_name) or product_name.replace(' ', '_')
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        filename = f"{safe_product}_{timestamp}.pdf"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

        # 기존 파일 삭제
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT spec_file_path FROM product_spec WHERE product_name = ?', (product_name,))
            row = cursor.fetchone()
            if row and row['spec_file_path']:
                old_path = os.path.join(app.config['UPLOAD_FOLDER'], row['spec_file_path'])
                if os.path.exists(old_path):
                    os.remove(old_path)

        # 파일 저장
        file.save(filepath)

        # DB 업데이트
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM product_spec WHERE product_name = ?', (product_name,))
            existing = cursor.fetchone()

            if existing:
                cursor.execute('''
                    UPDATE product_spec
                    SET spec_file_name = ?, spec_file_path = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE product_name = ?
                ''', (file.filename, filename, product_name))
            else:
                cursor.execute('''
                    INSERT INTO product_spec (product_name, spec_file_name, spec_file_path)
                    VALUES (?, ?, ?)
                ''', (product_name, file.filename, filename))

            conn.commit()

        return jsonify({
            'success': True,
            'message': f'규격서가 업로드되었습니다.',
            'file_name': file.filename
        })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/product-spec/download/<product_name>', methods=['GET'])
def download_product_spec(product_name):
    """제품 규격서 PDF 다운로드"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT spec_file_name, spec_file_path FROM product_spec WHERE product_name = ?', (product_name,))
            row = cursor.fetchone()

            if not row or not row['spec_file_path']:
                return jsonify({'success': False, 'message': '규격서 파일이 없습니다.'}), 404

            filepath = os.path.join(app.config['UPLOAD_FOLDER'], row['spec_file_path'])
            if not os.path.exists(filepath):
                return jsonify({'success': False, 'message': '파일을 찾을 수 없습니다.'}), 404

            return send_from_directory(
                app.config['UPLOAD_FOLDER'],
                row['spec_file_path'],
                download_name=row['spec_file_name'],
                as_attachment=False
            )

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/product-spec/delete-file', methods=['POST'])
def delete_product_spec_file():
    """제품 규격서 PDF 삭제"""
    try:
        data = request.get_json()
        product_name = data.get('product_name', '')

        if not product_name:
            return jsonify({'success': False, 'message': '제품명이 필요합니다.'})

        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT spec_file_path FROM product_spec WHERE product_name = ?', (product_name,))
            row = cursor.fetchone()

            if row and row['spec_file_path']:
                old_path = os.path.join(app.config['UPLOAD_FOLDER'], row['spec_file_path'])
                if os.path.exists(old_path):
                    os.remove(old_path)

            cursor.execute('''
                UPDATE product_spec
                SET spec_file_name = '', spec_file_path = '', updated_at = CURRENT_TIMESTAMP
                WHERE product_name = ?
            ''', (product_name,))
            conn.commit()

        return jsonify({'success': True, 'message': '규격서 파일이 삭제되었습니다.'})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


# ============================================
# API: 배합 작업 (Blending Work)
# ============================================

@app.route('/api/blending/products', methods=['GET'])
def get_blending_products():
    """배합 가능한 제품 목록 조회 (Recipe가 있는 제품만)"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()

            cursor.execute('''
                SELECT DISTINCT product_name, product_code
                FROM recipe
                WHERE is_active = 1
                ORDER BY product_name
            ''')

            products = [dict_from_row(row) for row in cursor.fetchall()]

            return jsonify({'success': True, 'data': products})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/blending/recipe/<product_name>', methods=['GET'])
def get_blending_recipe(product_name):
    """특정 제품의 Recipe 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()

            cursor.execute('''
                SELECT * FROM recipe
                WHERE product_name = ? AND is_active = 1
                ORDER BY id
            ''', (product_name,))

            recipes = [dict_from_row(row) for row in cursor.fetchall()]

            return jsonify({'success': True, 'data': recipes})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/blending/start', methods=['POST'])
def start_blending_work():
    """배합 작업 시작"""
    try:
        data = request.json

        required_fields = ['product_name', 'batch_lot', 'target_total_weight', 'operator']
        if not all(field in data for field in required_fields):
            return jsonify({'success': False, 'message': '필수 항목이 누락되었습니다.'})

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 중복 확인 (batch_lot)
            cursor.execute('''
                SELECT id FROM blending_work WHERE batch_lot = ?
            ''', (data['batch_lot'],))

            if cursor.fetchone():
                return jsonify({'success': False, 'message': '이미 존재하는 배합 LOT입니다.'})

            # work_order가 있으면 중복 확인
            # work_order가 있으면 중복 확인 (단, 작업지시서 ID가 주어진 경우엔 동일 작업지시번호로
            # 여러 작업을 생성할 수 있도록 허용)
            if data.get('work_order') and not data.get('work_order_id'):
                cursor.execute('''
                    SELECT id FROM blending_work WHERE work_order = ?
                ''', (data['work_order'],))

                if cursor.fetchone():
                    return jsonify({'success': False, 'message': '이미 존재하는 작업지시 번호입니다.'})

            # Main 분말 중량 정보를 JSON으로 변환
            main_powder_weights_json = None
            if 'main_powder_weights' in data and data['main_powder_weights']:
                import json
                main_powder_weights_json = json.dumps(data['main_powder_weights'], ensure_ascii=False)

            # 배합 작업 레코드 생성
            cursor.execute('''
                INSERT INTO blending_work (
                    work_order_id, work_order, product_name, product_code, batch_lot,
                    target_total_weight, operator, status, main_powder_weights
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?)
            ''', (
                data.get('work_order_id'),  # 작업지시서 ID (optional)
                data.get('work_order'),      # 작업지시 번호 (optional)
                data['product_name'],
                data.get('product_code', ''),
                data['batch_lot'],
                data['target_total_weight'],
                data['operator'],
                main_powder_weights_json
            ))

            work_id = cursor.lastrowid
            conn.commit()

            return jsonify({
                'success': True,
                'work_id': work_id,
                'batch_lot': data['batch_lot']
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/blending/generate-lot', methods=['GET'])
def generate_batch_lot():
    """배합 LOT 번호 자동 생성"""
    try:
        # YYMMDD-XXX 형식 (KST 기준 날짜, 년도 2자리)
        today = datetime.now(ZoneInfo('Asia/Seoul')).strftime('%y%m%d')
        prefix = f'{today}-'

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 오늘 생성된 배치 중 마지막 번호 조회
            cursor.execute('''
                SELECT batch_lot FROM blending_work
                WHERE batch_lot LIKE ?
                ORDER BY batch_lot DESC
                LIMIT 1
            ''', (f'{prefix}%',))

            row = cursor.fetchone()

            if row:
                # 마지막 번호에서 1 증가
                last_lot = row[0]
                last_num = int(last_lot.split('-')[-1])
                next_num = last_num + 1
            else:
                # 오늘 첫 번째
                next_num = 1

            new_lot = f'{prefix}{next_num:03d}'

            return jsonify({'success': True, 'batch_lot': new_lot})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/blending/work/<int:work_id>', methods=['GET'])
def get_blending_work(work_id):
    """배합 작업 상세 조회 (Recipe 포함)"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 배합 작업 정보 조회
            cursor.execute('''
                SELECT * FROM blending_work
                WHERE id = ?
            ''', (work_id,))

            work_row = cursor.fetchone()

            if not work_row:
                return jsonify({'success': False, 'message': '배합 작업을 찾을 수 없습니다.'})

            work = dict_from_row(work_row)

            # Main 분말 중량 정보 파싱
            import json
            if work.get('main_powder_weights'):
                try:
                    work['main_powder_weights'] = json.loads(work['main_powder_weights'])
                except:
                    work['main_powder_weights'] = {}
            else:
                work['main_powder_weights'] = {}

            # Recipe 조회
            cursor.execute('''
                SELECT * FROM recipe
                WHERE product_name = ? AND is_active = 1
                ORDER BY id
            ''', (work['product_name'],))

            recipes = [dict_from_row(row) for row in cursor.fetchall()]

            # 이미 투입된 원재료 조회
            cursor.execute('''
                SELECT * FROM material_input
                WHERE blending_work_id = ?
                ORDER BY id
            ''', (work_id,))

            material_inputs = [dict_from_row(row) for row in cursor.fetchall()]

            # Main 분말들 찾기
            main_recipes = [r for r in recipes if r.get('is_main')]

            # 각 Recipe에 목표 중량 계산
            if main_recipes:
                # Main 분말 중량 합계 및 비율 합계
                total_main_weight = sum(work['main_powder_weights'].get(r['powder_name'], 0) for r in main_recipes)
                total_main_ratio = sum(r['ratio'] for r in main_recipes)

                for recipe in recipes:
                    if recipe.get('is_main'):
                        # Main 분말: 개별 지정 중량
                        recipe['calculated_weight'] = work['main_powder_weights'].get(recipe['powder_name'], 0)
                    elif total_main_weight > 0 and total_main_ratio > 0:
                        # 다른 분말: 전체 main 중량 × (해당 비율 / 전체 main 비율)
                        recipe['calculated_weight'] = total_main_weight * (recipe['ratio'] / total_main_ratio)
                    else:
                        recipe['calculated_weight'] = 0
            else:
                # Main 분말이 없는 경우 기존 방식
                for recipe in recipes:
                    recipe['calculated_weight'] = (work['target_total_weight'] * recipe['ratio'] / 100) if work['target_total_weight'] else 0

            return jsonify({
                'success': True,
                'work': work,
                'recipes': recipes,
                'material_inputs': material_inputs
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/blending/work/<int:work_id>', methods=['DELETE'])
def delete_blending_work(work_id):
    """배합 작업 삭제"""
    try:

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 작업 정보 확인
            cursor.execute('''
                SELECT status, batch_lot FROM blending_work WHERE id = ?
            ''', (work_id,))

            work = cursor.fetchone()

            if not work:
                return jsonify({'success': False, 'message': '배합 작업을 찾을 수 없습니다.'})

            # 관련 원재료 투입 데이터 삭제
            cursor.execute('''
                DELETE FROM material_input WHERE blending_work_id = ?
            ''', (work_id,))

            # 배합 작업 삭제
            cursor.execute('''
                DELETE FROM blending_work WHERE id = ?
            ''', (work_id,))

            conn.commit()

            return jsonify({
                'success': True,
                'message': f'배합 LOT "{work[1]}"이(가) 삭제되었습니다.'
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/blending/work/<int:work_id>/hide', methods=['PATCH'])
def hide_blending_work(work_id):
    """배합작업 숨기기/복원"""
    try:
        data = request.get_json() or {}
        hide = data.get('hide', True)
        hidden_by = data.get('hidden_by', '')
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            if hide:
                cursor.execute('''
                    UPDATE blending_work SET is_hidden=1, hidden_at=datetime('now','localtime'), hidden_by=?
                    WHERE id=?
                ''', (hidden_by, work_id))
            else:
                cursor.execute('''
                    UPDATE blending_work SET is_hidden=0, hidden_at=NULL, hidden_by=NULL
                    WHERE id=?
                ''', (work_id,))
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/completed-lots', methods=['GET'])
def get_completed_lots():
    """특정 분말의 수입검사 완료된 LOT 번호 목록 조회"""
    try:
        powder_name = request.args.get('powder_name')
        category = request.args.get('category', 'incoming')

        if not powder_name:
            return jsonify({'success': False, 'message': 'powder_name is required'})

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 수입검사 완료(PASS)된 LOT만 조회
            cursor.execute('''
                SELECT lot_number, inspection_time, final_result
                FROM inspection_result
                WHERE powder_name = ? AND category = ? AND final_result = 'PASS'
                ORDER BY inspection_time DESC
            ''', (powder_name, category))

            lots = []
            for row in cursor.fetchall():
                lot_dict = dict_from_row(row)
                lots.append({
                    'lot_number': lot_dict['lot_number'],
                    'inspection_time': lot_dict['inspection_time']
                })

            return jsonify({'success': True, 'lots': lots})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/blending/validate-lot/<lot_number>', methods=['GET'])
def validate_material_lot(lot_number):
    """원재료 LOT 검증 (수입검사 완료 여부 확인)"""
    try:
        # 쿼리 파라미터로 분말명 받기
        powder_name = request.args.get('powder_name', '')

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 수입검사 결과에서 LOT와 분말명으로 조회
            if powder_name:
                cursor.execute('''
                    SELECT powder_name, lot_number, final_result, inspection_time
                    FROM inspection_result
                    WHERE lot_number = ? AND powder_name = ? AND category = 'incoming'
                ''', (lot_number, powder_name))
            else:
                # 하위 호환성: 분말명이 없으면 LOT만으로 검색 (기존 방식)
                cursor.execute('''
                    SELECT powder_name, lot_number, final_result, inspection_time
                    FROM inspection_result
                    WHERE lot_number = ? AND category = 'incoming'
                ''', (lot_number,))

            row = cursor.fetchone()

            if not row:
                if powder_name:
                    return jsonify({
                        'success': False,
                        'valid': False,
                        'message': f'LOT {lot_number}의 {powder_name} 수입검사 기록이 없습니다.'
                    })
                else:
                    return jsonify({
                        'success': False,
                        'valid': False,
                        'message': f'LOT {lot_number}는 수입검사 기록이 없습니다.'
                    })

            result = dict_from_row(row)

            if result['final_result'] != 'PASS':
                return jsonify({
                    'success': False,
                    'valid': False,
                    'message': f'LOT {lot_number}는 수입검사에서 불합격 처리되었습니다.'
                })

            return jsonify({
                'success': True,
                'valid': True,
                'powder_name': result['powder_name'],
                'lot_number': result['lot_number'],
                'inspection_time': result['inspection_time']
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/blending/material-input', methods=['POST'])
def save_material_input():
    """원재료 투입 기록 저장"""
    try:
        data = request.json

        required_fields = ['blending_work_id', 'powder_name', 'material_lot', 'target_weight', 'actual_weight']
        if not all(field in data for field in required_fields):
            return jsonify({'success': False, 'message': '필수 항목이 누락되었습니다.'})

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 1. 이종분말 검증 (제품명과 LOT번호 둘 다 비교하여 검증)
            # 복수 LOT 지원: 쉼표로 구분된 LOT를 분리하여 검증
            material_lots = [lot.strip() for lot in data['material_lot'].split(',')]

            for lot in material_lots:
                # 제품명과 LOT 번호로 함께 조회 (lot번호가 동일해도 제품명이 다르면 구분)
                cursor.execute('''
                    SELECT powder_name FROM inspection_result
                    WHERE lot_number = ? AND powder_name = ? AND category = 'incoming'
                ''', (lot, data['powder_name']))

                lot_row = cursor.fetchone()

                if not lot_row:
                    # 먼저 LOT가 존재하는지 확인
                    cursor.execute('''
                        SELECT powder_name FROM inspection_result
                        WHERE lot_number = ? AND category = 'incoming'
                    ''', (lot,))
                    
                    check_row = cursor.fetchone()
                    
                    if not check_row:
                        return jsonify({
                            'success': False,
                            'message': f'LOT {lot}의 수입검사 기록을 찾을 수 없습니다.'
                        })
                    else:
                        # LOT는 있지만 제품명이 다른 경우
                        actual_powder = check_row[0]
                        return jsonify({
                            'success': False,
                            'message': f'이종분말 검출! 투입하려는 분말({data["powder_name"]})과 LOT {lot}의 실제 분말({actual_powder})이 다릅니다.',
                            'is_wrong_material': True
                        })

            # 2. 중량 편차 계산
            target_weight = float(data['target_weight'])
            actual_weight = float(data['actual_weight'])
            weight_deviation = ((actual_weight - target_weight) / target_weight * 100) if target_weight > 0 else 0
            weight_deviation = round(weight_deviation, 2)

            # 3. 허용 오차 확인 (g 절대값 기준)
            tolerance_minus = float(data.get('tolerance_minus', 5))
            tolerance_plus = float(data.get('tolerance_plus', 5))
            min_allowed = target_weight - tolerance_minus / 1000  # g → kg
            max_allowed = target_weight + tolerance_plus / 1000  # g → kg
            is_valid = min_allowed <= actual_weight <= max_allowed

            validation_message = None
            if not is_valid:
                validation_message = f'실측 중량({actual_weight:.3f}kg)이 허용 범위({min_allowed:.3f} ~ {max_allowed:.3f}kg)를 초과했습니다.'

                # NG(부적정) 판정일 경우 저장 거부
                return jsonify({
                    'success': False,
                    'is_valid': False,
                    'message': f'부적정(NG) 판정되어 저장할 수 없습니다.\n{validation_message}',
                    'validation_message': validation_message,
                    'weight_deviation': weight_deviation
                })

            # 4. material_input 테이블에 저장 (적정 판정된 경우만)
            cursor.execute('''
                INSERT INTO material_input (
                    blending_work_id, powder_name, powder_category, material_lot,
                    target_weight, actual_weight, weight_deviation, is_valid,
                    validation_message, input_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                data['blending_work_id'],
                data['powder_name'],
                data.get('powder_category', 'incoming'),
                data['material_lot'],
                target_weight,
                actual_weight,
                weight_deviation,
                1 if is_valid else 0,
                validation_message,
                data.get('operator', '미지정')
            ))

            material_input_id = cursor.lastrowid

            # 5. 배합 작업의 실제 총 중량 업데이트
            cursor.execute('''
                SELECT COALESCE(SUM(actual_weight), 0) FROM material_input
                WHERE blending_work_id = ?
            ''', (data['blending_work_id'],))

            total_actual_weight = cursor.fetchone()[0]

            cursor.execute('''
                UPDATE blending_work
                SET actual_total_weight = ?
                WHERE id = ?
            ''', (total_actual_weight, data['blending_work_id']))

            conn.commit()

            return jsonify({
                'success': True,
                'material_input_id': material_input_id,
                'weight_deviation': weight_deviation,
                'is_valid': is_valid,
                'validation_message': validation_message
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/blending/complete/<int:work_id>', methods=['PUT'])
def complete_blending_work(work_id):
    """배합 작업 완료 처리"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 모든 원재료가 투입되었는지 확인
            cursor.execute('''
                SELECT COUNT(*) FROM recipe
                WHERE product_name = (
                    SELECT product_name FROM blending_work WHERE id = ?
                ) AND is_active = 1
            ''', (work_id,))

            expected_count = cursor.fetchone()[0]

            cursor.execute('''
                SELECT COUNT(*) FROM material_input
                WHERE blending_work_id = ?
            ''', (work_id,))

            actual_count = cursor.fetchone()[0]

            if actual_count < expected_count:
                return jsonify({
                    'success': False,
                    'message': f'아직 모든 원재료가 투입되지 않았습니다. ({actual_count}/{expected_count})'
                })

            # 배합 작업 상태를 완료로 변경
            cursor.execute('''
                UPDATE blending_work
                SET status = 'completed', end_time = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (work_id,))

            conn.commit()

            return jsonify({'success': True, 'message': '배합 작업이 완료되었습니다.'})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/blending/works', methods=['GET'])
def get_blending_works():
    """배합작업 목록 조회 (완료된 작업 포함)"""
    try:
        status = request.args.get('status', 'all')  # all, completed, in_progress
        product_name = request.args.get('product_name')
        batch_lot = request.args.get('batch_lot')
        completed_date_from = request.args.get('completed_date_from')  # YYYY-MM-DD
        completed_date_to = request.args.get('completed_date_to')  # YYYY-MM-DD
        include_hidden = request.args.get('include_hidden', 'false').lower() == 'true'

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # Build dynamic query with optional filters
            base_select = '''
                SELECT
                    id, work_order, product_name, product_code, batch_lot,
                    target_total_weight, actual_total_weight,
                    blending_time, blending_temperature, blending_rpm,
                    operator, status, start_time, end_time, notes, is_hidden
                FROM blending_work
            '''

            where_clauses = []
            params = []

            if status and status != 'all':
                where_clauses.append('status = ?')
                params.append(status)

            if product_name:
                where_clauses.append('product_name LIKE ?')
                params.append(f"%{product_name}%")

            if batch_lot:
                where_clauses.append('batch_lot LIKE ?')
                params.append(f"%{batch_lot}%")

            # 날짜 범위 필터 (완료 작업은 end_time, 진행중 작업은 start_time 기준)
            if completed_date_from and completed_date_to:
                where_clauses.append("DATE(COALESCE(end_time, start_time)) BETWEEN ? AND ?")
                params.append(completed_date_from)
                params.append(completed_date_to)
            elif completed_date_from:
                where_clauses.append("DATE(COALESCE(end_time, start_time)) >= ?")
                params.append(completed_date_from)
            elif completed_date_to:
                where_clauses.append("DATE(COALESCE(end_time, start_time)) <= ?")
                params.append(completed_date_to)

            if not include_hidden:
                where_clauses.append('(is_hidden IS NULL OR is_hidden = 0)')

            query = base_select
            if where_clauses:
                query += ' WHERE ' + ' AND '.join(where_clauses)

            query += ' ORDER BY created_at DESC'

            cursor.execute(query, tuple(params))

            works = []
            for row in cursor.fetchall():
                work_dict = dict_from_row(row)

                # 시간을 KST로 변환
                work_dict = convert_times_in_dict(work_dict)

                # 각 배합작업에 대한 진행률 계산 (진행중인 작업만)
                if work_dict['status'] == 'in_progress':
                    # 투입 완료된 원재료 개수
                    cursor.execute('''
                        SELECT COUNT(DISTINCT powder_name)
                        FROM material_input
                        WHERE blending_work_id = ?
                    ''', (work_dict['id'],))
                    material_input_count = cursor.fetchone()[0]

                    # 레시피의 전체 원재료 개수
                    cursor.execute('''
                        SELECT COUNT(*)
                        FROM recipe
                        WHERE product_name = ? AND is_active = 1
                    ''', (work_dict['product_name'],))
                    total_materials = cursor.fetchone()[0]

                    work_dict['material_input_count'] = material_input_count
                    work_dict['total_materials'] = total_materials

                # 각 배합작업에 대한 검사 상태 조회
                cursor.execute('''
                    SELECT final_result
                    FROM inspection_result
                    WHERE lot_number = ? AND category = 'mixing'
                    ORDER BY inspection_time DESC
                    LIMIT 1
                ''', (work_dict['batch_lot'],))

                inspection_row = cursor.fetchone()

                # 디버깅: 상태 확인
                print(f"[DEBUG] LOT: {work_dict['batch_lot']}, inspection_row: {inspection_row}")

                # final_result가 NULL이 아닐 때만 검사 완료로 판단
                if inspection_row and inspection_row[0] is not None:
                    print(f"[DEBUG] LOT: {work_dict['batch_lot']} - 검사 완료 (final_result={inspection_row[0]})")
                    work_dict['inspection_status'] = 'completed'
                    work_dict['inspection_result'] = inspection_row[0]
                else:
                    # 진행중인 검사가 있는지 확인
                    cursor.execute('''
                        SELECT 1
                        FROM inspection_progress
                        WHERE lot_number = ? AND category = 'mixing'
                        LIMIT 1
                    ''', (work_dict['batch_lot'],))

                    progress_exists = cursor.fetchone()
                    print(f"[DEBUG] LOT: {work_dict['batch_lot']} - inspection_progress 존재: {progress_exists is not None}")

                    if progress_exists:
                        work_dict['inspection_status'] = 'in_progress'
                        work_dict['inspection_result'] = None
                    else:
                        work_dict['inspection_status'] = None
                        work_dict['inspection_result'] = None

                    print(f"[DEBUG] LOT: {work_dict['batch_lot']} - 최종 상태: {work_dict['inspection_status']}")

                works.append(work_dict)

            return jsonify({'success': True, 'works': works})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# API: 추적성 (Traceability)
# ============================================

@app.route('/api/traceability/batch/<batch_lot>', methods=['GET'])
def trace_by_batch_lot(batch_lot):
    """배합 LOT로 추적 (Backward Traceability): 배합 → 원재료 → 수입검사"""
    product_name = request.args.get('product_name', '')
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 1. 배합 작업 정보 조회
            cursor.execute('''
                SELECT * FROM blending_work
                WHERE batch_lot = ?
            ''', (batch_lot,))

            work_row = cursor.fetchone()

            if not work_row:
                return jsonify({
                    'success': False,
                    'message': f'배합 LOT {batch_lot}를 찾을 수 없습니다.'
                })

            work = dict_from_row(work_row)

            # 2. 원재료 투입 이력 조회
            cursor.execute('''
                SELECT * FROM material_input
                WHERE blending_work_id = ?
                ORDER BY id
            ''', (work['id'],))

            raw_inputs = [dict_from_row(row) for row in cursor.fetchall()]

            # 같은 분말+같은 LOT가 분할 투입된 경우 중량 합산하여 1건으로 그룹핑
            grouped = {}
            for m in raw_inputs:
                key = (m['powder_name'], m['material_lot'])
                if key not in grouped:
                    grouped[key] = dict(m)
                else:
                    grouped[key]['actual_weight'] = round(
                        float(grouped[key]['actual_weight']) + float(m['actual_weight']), 3
                    )
                    grouped[key]['target_weight'] = round(
                        float(grouped[key]['target_weight']) + float(m['target_weight']), 3
                    )
            material_inputs = list(grouped.values())

            # 3. 각 원재료의 수입검사 결과 조회 (제품명과 lot번호로 조회)
            for material in material_inputs:
                cursor.execute('''
                    SELECT powder_name, lot_number, inspection_type, inspector,
                           inspection_time, final_result
                    FROM inspection_result
                    WHERE lot_number = ? AND powder_name = ? AND category = 'incoming'
                ''', (material['material_lot'], material['powder_name']))

                inspection_row = cursor.fetchone()
                if inspection_row:
                    material['incoming_inspection'] = dict_from_row(inspection_row)
                else:
                    material['incoming_inspection'] = None

            return jsonify({
                'success': True,
                'trace_type': 'backward',
                'batch_lot': batch_lot,
                'blending_work': work,
                'material_inputs': material_inputs
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/traceability/material/<material_lot>', methods=['GET'])
def trace_by_material_lot(material_lot):
    """원재료 LOT와 분말명으로 추적 (Forward Traceability): 수입검사 → 사용된 배합들"""
    powder_name = request.args.get('powder_name', '')
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 1. 수입검사 결과 조회 (제품명과 lot번호로 조회)
            if powder_name:
                cursor.execute('''
                    SELECT * FROM inspection_result
                    WHERE lot_number = ? AND powder_name = ? AND category = 'incoming'
                ''', (material_lot, powder_name))
            else:
                # powder_name이 없으면 lot번호만으로 검색
                cursor.execute('''
                    SELECT * FROM inspection_result
                    WHERE lot_number = ? AND category = 'incoming'
                ''', (material_lot,))

            inspection_row = cursor.fetchone()

            if not inspection_row:
                if powder_name:
                    return jsonify({
                        'success': False,
                        'message': f'분말명({powder_name})과 LOT {material_lot}의 수입검사 기록을 찾을 수 없습니다.'
                    })
                else:
                    return jsonify({
                        'success': False,
                        'message': f'원재료 LOT {material_lot}의 수입검사 기록을 찾을 수 없습니다.'
                    })

            inspection = dict_from_row(inspection_row)

            # inspection에서 powder_name 가져오기 (빈 문자열인 경우 대비)
            actual_powder_name = inspection['powder_name']

            # 2. 이 LOT과 분말명이 사용된 모든 배합 작업 조회
            # 같은 LOT가 분할 투입된 경우 GROUP BY로 중복 배합 제거, 실투입량 합산
            cursor.execute('''
                SELECT
                    bw.id,
                    bw.work_order,
                    bw.product_name,
                    bw.batch_lot,
                    bw.target_total_weight,
                    bw.actual_total_weight,
                    bw.operator,
                    bw.status,
                    bw.start_time,
                    bw.end_time,
                    SUM(mi.actual_weight) as actual_weight,
                    SUM(mi.target_weight) as target_weight
                FROM material_input mi
                JOIN blending_work bw ON mi.blending_work_id = bw.id
                WHERE mi.material_lot = ? AND mi.powder_name = ?
                GROUP BY bw.id
                ORDER BY bw.start_time DESC
            ''', (material_lot, actual_powder_name))

            usages = [dict_from_row(row) for row in cursor.fetchall()]

            # 시간 필드 KST 변환
            convert_times_in_dict(inspection)
            for usage in usages:
                convert_times_in_dict(usage)

            return jsonify({
                'success': True,
                'trace_type': 'forward',
                'material_lot': material_lot,
                'incoming_inspection': inspection,
                'used_in_batches': usages
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/traceability/search', methods=['GET'])
def search_traceability():
    """통합 추적성 검색 (분말명과 LOT번호로 검색)"""
    try:
        lot_number = request.args.get('lot_number', '')
        powder_name = request.args.get('powder_name', '')

        if not lot_number:
            return jsonify({'success': False, 'message': 'LOT 번호를 입력하세요.'})

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            result = {
                'success': True,
                'lot_number': lot_number,
                'powder_name': powder_name,
                'found_as': []
            }

            # 1. 배합 LOT로 검색
            cursor.execute('''
                SELECT COUNT(*) FROM blending_work
                WHERE batch_lot = ?
            ''', (lot_number,))

            if cursor.fetchone()[0] > 0:
                result['found_as'].append('batch_lot')

            # 2. 원재료 LOT로 검색 (분말명도 함께 검색)
            if powder_name:
                cursor.execute('''
                    SELECT COUNT(*) FROM inspection_result
                    WHERE lot_number = ? AND powder_name = ? AND category = 'incoming'
                ''', (lot_number, powder_name))
            else:
                cursor.execute('''
                    SELECT COUNT(*) FROM inspection_result
                    WHERE lot_number = ? AND category = 'incoming'
                ''', (lot_number,))

            if cursor.fetchone()[0] > 0:
                result['found_as'].append('material_lot')

            if not result['found_as']:
                if powder_name:
                    return jsonify({
                        'success': False,
                        'message': f'분말명({powder_name})과 LOT {lot_number}를 찾을 수 없습니다.'
                    })
                else:
                    return jsonify({
                        'success': False,
                        'message': f'LOT {lot_number}를 찾을 수 없습니다.'
                    })

            return jsonify(result)

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# 배합작업지시서 (Blending Order) API
# ============================================

@app.route('/api/blending-orders', methods=['POST'])
def create_blending_order():
    """배합작업지시서 생성"""
    try:
        data = request.json

        required_fields = ['product_name', 'total_target_weight']
        if not all(field in data for field in required_fields):
            return jsonify({'success': False, 'message': '필수 항목이 누락되었습니다.'})

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 작업지시번호 자동 생성 (WO-YYYYMMDD-001 형식)
            today = datetime.now(ZoneInfo('Asia/Seoul')).strftime('%Y%m%d')

            cursor.execute('''
                SELECT work_order_number FROM blending_order
                WHERE work_order_number LIKE ?
                ORDER BY work_order_number DESC
                LIMIT 1
            ''', (f'WO-{today}-%',))

            last_order = cursor.fetchone()

            if last_order:
                # 마지막 번호 추출 및 증가
                last_num = int(last_order[0].split('-')[-1])
                new_num = last_num + 1
            else:
                new_num = 1

            work_order_number = f'WO-{today}-{new_num:03d}'

            # 작업지시서 저장 (work_date가 전달되면 created_date에 사용)
            work_date = data.get('work_date')
            if work_date:
                cursor.execute('''
                    INSERT INTO blending_order (
                        work_order_number, product_name, product_code,
                        total_target_weight, created_by, notes, created_date
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    work_order_number,
                    data['product_name'],
                    data.get('product_code'),
                    float(data['total_target_weight']),
                    data.get('created_by', '미지정'),
                    data.get('notes'),
                    work_date
                ))
            else:
                cursor.execute('''
                    INSERT INTO blending_order (
                        work_order_number, product_name, product_code,
                        total_target_weight, created_by, notes
                    ) VALUES (?, ?, ?, ?, ?, ?)
                ''', (
                    work_order_number,
                    data['product_name'],
                    data.get('product_code'),
                    float(data['total_target_weight']),
                    data.get('created_by', '미지정'),
                    data.get('notes')
                ))

            order_id = cursor.lastrowid
            conn.commit()

            return jsonify({
                'success': True,
                'order_id': order_id,
                'work_order_number': work_order_number,
                'message': f'작업지시서가 생성되었습니다. ({work_order_number})'
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/blending-orders', methods=['GET'])
def get_blending_orders():
    """배합작업지시서 목록 조회"""
    try:
        status_filter = request.args.get('status', 'all')
        date_from = request.args.get('date_from', '')
        date_to = request.args.get('date_to', '')
        include_hidden = request.args.get('include_hidden', 'false').lower() == 'true'

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 기본 WHERE 조건 구성
            where_clauses = []
            params = []

            # 숨긴 계획 필터 (기본: 숨긴 계획 제외)
            if not include_hidden:
                where_clauses.append('(is_hidden IS NULL OR is_hidden = 0)')

            if status_filter != 'all':
                where_clauses.append('status = ?')
                params.append(status_filter)

            if date_from:
                where_clauses.append('created_date >= ?')
                params.append(date_from)

            if date_to:
                where_clauses.append('created_date <= ?')
                params.append(date_to)

            # SQL 쿼리 구성
            if where_clauses:
                where_sql = 'WHERE ' + ' AND '.join(where_clauses)
                cursor.execute(f'''
                    SELECT * FROM blending_order
                    {where_sql}
                    ORDER BY created_date ASC, id ASC
                ''', params)
            else:
                cursor.execute('''
                    SELECT * FROM blending_order
                    ORDER BY created_date ASC, id ASC
                ''')

            rows = cursor.fetchall()
            orders = []

            for row in rows:
                order = dict(row)

                # 진도율 계산
                cursor.execute('''
                    SELECT COALESCE(SUM(target_total_weight), 0)
                    FROM blending_work
                    WHERE work_order_id = ? AND status = 'completed'
                ''', (order['id'],))

                completed_weight = cursor.fetchone()[0]
                total_target_weight = order['total_target_weight']

                if total_target_weight > 0:
                    progress_percent = (completed_weight / total_target_weight) * 100
                else:
                    progress_percent = 0

                order['completed_weight'] = completed_weight
                order['progress_percent'] = round(progress_percent, 1)

                # 진행 중인 배합 작업 수
                cursor.execute('''
                    SELECT COUNT(*) FROM blending_work
                    WHERE work_order_id = ? AND status = 'in_progress'
                ''', (order['id'],))

                order['in_progress_count'] = cursor.fetchone()[0]

                # 완료된 배합 작업 수
                cursor.execute('''
                    SELECT COUNT(*) FROM blending_work
                    WHERE work_order_id = ? AND status = 'completed'
                ''', (order['id'],))

                order['completed_count'] = cursor.fetchone()[0]

                # 자동으로 상태 업데이트 (진도율 100%면 완료)
                if progress_percent >= 100 and order['status'] != 'completed':
                    cursor.execute('''
                        UPDATE blending_order
                        SET status = 'completed', updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    ''', (order['id'],))
                    conn.commit()
                    order['status'] = 'completed'

                orders.append(order)

            return jsonify({
                'success': True,
                'orders': orders
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/blending-orders/<int:order_id>', methods=['GET'])
def get_blending_order(order_id):
    """배합작업지시서 상세 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()

            cursor.execute('SELECT * FROM blending_order WHERE id = ?', (order_id,))
            row = cursor.fetchone()

            if not row:
                return jsonify({'success': False, 'message': '작업지시서를 찾을 수 없습니다.'})

            order = dict(row)

            # 진도율 계산
            cursor.execute('''
                SELECT COALESCE(SUM(target_total_weight), 0)
                FROM blending_work
                WHERE work_order_id = ? AND status = 'completed'
            ''', (order_id,))

            completed_weight = cursor.fetchone()[0]
            total_target_weight = order['total_target_weight']

            if total_target_weight > 0:
                progress_percent = (completed_weight / total_target_weight) * 100
            else:
                progress_percent = 0

            order['completed_weight'] = completed_weight
            order['progress_percent'] = round(progress_percent, 1)

            # 연관된 배합 작업 목록
            cursor.execute('''
                SELECT * FROM blending_work
                WHERE work_order_id = ?
                ORDER BY start_time DESC
            ''', (order_id,))

            order['blending_works'] = [dict(row) for row in cursor.fetchall()]

            return jsonify({
                'success': True,
                'order': order
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/blending-orders/<int:order_id>', methods=['DELETE'])
def delete_blending_order(order_id):
    """작업지시서 삭제 (연관된 배합작업이 있으면 삭제 불가)"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 연관된 배합작업이 있는지 확인
            cursor.execute('SELECT COUNT(*) FROM blending_work WHERE work_order_id = ?', (order_id,))
            cnt = cursor.fetchone()[0]
            if cnt > 0:
                return jsonify({'success': False, 'message': '연관된 배합작업이 있어 삭제할 수 없습니다. 관련 작업을 먼저 삭제하세요.'})

            cursor.execute('DELETE FROM blending_order WHERE id = ?', (order_id,))
            conn.commit()

            return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/blending-orders/<int:order_id>/hide', methods=['PATCH'])
def toggle_blending_order_hidden(order_id):
    """배합작업지시서 숨기기/복원"""
    try:
        data = request.get_json() or {}
        hide = data.get('hide', True)  # True: 숨기기, False: 복원
        hidden_by = data.get('hidden_by', '')

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            cursor.execute('SELECT id, work_order_number FROM blending_order WHERE id = ?', (order_id,))
            order = cursor.fetchone()
            if not order:
                return jsonify({'success': False, 'message': '작업지시서를 찾을 수 없습니다.'})

            if hide:
                cursor.execute('''
                    UPDATE blending_order
                    SET is_hidden = 1, hidden_at = CURRENT_TIMESTAMP, hidden_by = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (hidden_by, order_id))
                msg = f'작업지시서 "{order[1]}"이(가) 숨겨졌습니다.'
            else:
                cursor.execute('''
                    UPDATE blending_order
                    SET is_hidden = 0, hidden_at = NULL, hidden_by = NULL, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (order_id,))
                msg = f'작업지시서 "{order[1]}"이(가) 복원되었습니다.'

            conn.commit()
            return jsonify({'success': True, 'message': msg})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/blending-orders/<int:order_id>/progress', methods=['GET'])
def get_blending_order_progress(order_id):
    """배합작업지시서 진도율 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 작업지시서 정보
            cursor.execute('SELECT total_target_weight FROM blending_order WHERE id = ?', (order_id,))
            row = cursor.fetchone()

            if not row:
                return jsonify({'success': False, 'message': '작업지시서를 찾을 수 없습니다.'})

            total_target_weight = row[0]

            # 완료된 중량 합계
            cursor.execute('''
                SELECT COALESCE(SUM(target_total_weight), 0)
                FROM blending_work
                WHERE work_order_id = ? AND status = 'completed'
            ''', (order_id,))

            completed_weight = cursor.fetchone()[0]

            # 진도율 계산
            if total_target_weight > 0:
                progress_percent = (completed_weight / total_target_weight) * 100
            else:
                progress_percent = 0

            # 남은 중량
            remaining_weight = total_target_weight - completed_weight

            return jsonify({
                'success': True,
                'total_target_weight': total_target_weight,
                'completed_weight': completed_weight,
                'remaining_weight': remaining_weight,
                'progress_percent': round(progress_percent, 1)
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ============================================
# 사용자 인증 / 권한 관리 (ID/PW 방식)
# ============================================

USERS_FILE = os.path.join(os.path.dirname(__file__), 'users.json')
PERMISSIONS_FILE = os.path.join(os.path.dirname(__file__), 'permissions.json')

ALL_MENUS = ['dashboard', 'incoming', 'blending-orders', 'blending',
             'blending-log', 'mixing', 'search', 'rework', 'traceability', 'admin']

def _hash_pw(password):
    import hashlib
    return hashlib.sha256(password.encode()).hexdigest()

def load_users():
    import json
    if not os.path.exists(USERS_FILE):
        default = {'cashup': {'password': _hash_pw('1234'), 'name': '프로그램관리자'}}
        with open(USERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(default, f, ensure_ascii=False, indent=2)
        return default
    with open(USERS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_users(data):
    import json
    with open(USERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_permissions():
    import json
    if not os.path.exists(PERMISSIONS_FILE):
        default = {'cashup': ALL_MENUS[:]}
        with open(PERMISSIONS_FILE, 'w', encoding='utf-8') as f:
            json.dump(default, f, ensure_ascii=False, indent=2)
        return default
    with open(PERMISSIONS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_permissions(data):
    import json
    with open(PERMISSIONS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def is_program_admin(user_id):
    perms = load_permissions()
    return set(perms.get(user_id, [])) == set(ALL_MENUS) and user_id == 'cashup'


@app.route('/api/login', methods=['POST'])
def login():
    """ID/PW 로그인"""
    try:
        data = request.get_json() or {}
        user_id = (data.get('userId') or '').strip()
        password = data.get('password', '')

        if not user_id or not password:
            return jsonify({'success': False, 'message': 'ID와 비밀번호를 입력하세요.'})

        users = load_users()
        user = users.get(user_id)

        if not user or user['password'] != _hash_pw(password):
            return jsonify({'success': False, 'message': 'ID 또는 비밀번호가 올바르지 않습니다.'})

        perms = load_permissions()
        allowed_menus = perms.get(user_id, [])

        return jsonify({
            'success': True,
            'userId': user_id,
            'name': user.get('name', user_id),
            'allowedMenus': allowed_menus,
            'isProgramAdmin': user_id == 'cashup'
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/users', methods=['GET'])
def get_users():
    """사용자 목록 조회 (프로그램관리자 전용)"""
    try:
        users = load_users()
        perms = load_permissions()
        result = []
        for uid, info in users.items():
            result.append({
                'userId': uid,
                'name': info.get('name', uid),
                'allowedMenus': perms.get(uid, [])
            })
        return jsonify({'success': True, 'users': result})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/users', methods=['POST'])
def add_user():
    """사용자 추가 (프로그램관리자 전용)"""
    try:
        data = request.get_json() or {}
        user_id = (data.get('userId') or '').strip()
        password = data.get('password', '')
        name = (data.get('name') or '').strip()

        if not user_id or not password or not name:
            return jsonify({'success': False, 'message': 'ID, 이름, 비밀번호를 모두 입력하세요.'})
        if len(password) < 4:
            return jsonify({'success': False, 'message': '비밀번호는 최소 4자 이상이어야 합니다.'})

        users = load_users()
        if user_id in users:
            return jsonify({'success': False, 'message': '이미 존재하는 ID입니다.'})

        users[user_id] = {'password': _hash_pw(password), 'name': name}
        save_users(users)

        perms = load_permissions()
        perms[user_id] = []
        save_permissions(perms)

        return jsonify({'success': True, 'message': f'사용자 "{name}"이(가) 추가되었습니다.'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/users/<user_id>/password', methods=['PUT'])
def change_user_password(user_id):
    """비밀번호 변경 (프로그램관리자 전용)"""
    try:
        data = request.get_json() or {}
        new_password = data.get('password', '')

        if len(new_password) < 4:
            return jsonify({'success': False, 'message': '비밀번호는 최소 4자 이상이어야 합니다.'})

        users = load_users()
        if user_id not in users:
            return jsonify({'success': False, 'message': '존재하지 않는 사용자입니다.'})

        users[user_id]['password'] = _hash_pw(new_password)
        save_users(users)
        return jsonify({'success': True, 'message': '비밀번호가 변경되었습니다.'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/users/<user_id>', methods=['DELETE'])
def delete_user(user_id):
    """사용자 삭제 (프로그램관리자 전용, cashup 삭제 불가)"""
    try:
        if user_id == 'cashup':
            return jsonify({'success': False, 'message': '프로그램관리자는 삭제할 수 없습니다.'})

        users = load_users()
        if user_id not in users:
            return jsonify({'success': False, 'message': '존재하지 않는 사용자입니다.'})

        del users[user_id]
        save_users(users)

        perms = load_permissions()
        if user_id in perms:
            del perms[user_id]
            save_permissions(perms)

        return jsonify({'success': True, 'message': '사용자가 삭제되었습니다.'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/permissions/<user_id>', methods=['PUT'])
def update_permissions(user_id):
    """사용자 메뉴 권한 업데이트 (프로그램관리자 전용)"""
    try:
        data = request.get_json() or {}
        allowed_menus = data.get('allowedMenus', [])

        users = load_users()
        if user_id not in users:
            return jsonify({'success': False, 'message': '존재하지 않는 사용자입니다.'})

        perms = load_permissions()
        perms[user_id] = [m for m in allowed_menus if m in ALL_MENUS]
        save_permissions(perms)
        return jsonify({'success': True, 'message': '권한이 저장되었습니다.'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/menus', methods=['GET'])
def get_all_menus():
    """전체 메뉴 목록"""
    return jsonify({'success': True, 'menus': ALL_MENUS})



# ============================================
# 대시보드 API
# ============================================

@app.route('/api/dashboard/kpi', methods=['GET'])
def get_dashboard_kpi():
    """대시보드 KPI 통계"""
    try:
        from datetime import date, timedelta

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            today = date.today().isoformat()
            week_start = (date.today() - timedelta(days=date.today().weekday())).isoformat()

            # 1. 오늘 배합 완료 건수
            cursor.execute('''
                SELECT COUNT(*) FROM blending_work
                WHERE DATE(end_time) = ? AND status='completed'
                AND (is_hidden IS NULL OR is_hidden=0)
            ''', (today,))
            today_blending = cursor.fetchone()[0]

            # 2. 이번주 배합 완료 건수
            cursor.execute('''
                SELECT COUNT(*) FROM blending_work
                WHERE DATE(end_time) >= ? AND status='completed'
                AND (is_hidden IS NULL OR is_hidden=0)
            ''', (week_start,))
            week_blending = cursor.fetchone()[0]

            # 3. 배합분말 검사 합격률 (이번주)
            cursor.execute('''
                SELECT COUNT(*) FROM inspection_result
                WHERE category='mixing' AND DATE(inspection_time) >= ?
                AND final_result IN ('PASS','FAIL')
                AND (is_hidden IS NULL OR is_hidden=0)
            ''', (week_start,))
            total_mix = cursor.fetchone()[0]

            cursor.execute('''
                SELECT COUNT(*) FROM inspection_result
                WHERE category='mixing' AND DATE(inspection_time) >= ?
                AND final_result = 'PASS'
                AND (is_hidden IS NULL OR is_hidden=0)
            ''', (week_start,))
            passed_mix = cursor.fetchone()[0]

            pass_rate = round((passed_mix / total_mix * 100), 1) if total_mix > 0 else 0

            # 4. 이번주 배합검사 NG 건수
            cursor.execute('''
                SELECT COUNT(*) FROM inspection_result
                WHERE category='mixing' AND DATE(inspection_time) >= ?
                AND final_result = 'FAIL'
                AND (is_hidden IS NULL OR is_hidden=0)
            ''', (week_start,))
            fail_count = cursor.fetchone()[0]

            return jsonify({
                'success': True,
                'data': {
                    'today_blending': today_blending,
                    'week_blending': week_blending,
                    'pass_rate': pass_rate,
                    'fail_count': fail_count
                }
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/dashboard/work-progress', methods=['GET'])
def get_work_progress():
    """작업지시 대비 진도율 (날짜 필터별)"""
    try:
        from datetime import date, timedelta

        date_filter = request.args.get('filter', 'week')  # today, week, month

        if date_filter == 'today':
            start_date = date.today().isoformat()
        elif date_filter == 'week':
            start_date = (date.today() - timedelta(days=date.today().weekday())).isoformat()
        else:  # month
            start_date = date.today().replace(day=1).isoformat()

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 작업지시별 진도율 (main 분말 실투입 중량 기준)
            cursor.execute('''
                SELECT
                    bo.work_order_number,
                    bo.product_name,
                    bo.total_target_weight,
                    COALESCE((
                        SELECT SUM(mi.actual_weight)
                        FROM blending_work bw2
                        JOIN material_input mi ON mi.blending_work_id = bw2.id
                        JOIN recipe r ON mi.powder_name = r.powder_name
                                      AND r.product_name = bo.product_name
                                      AND r.is_main = 1
                                      AND r.is_active = 1
                        WHERE bw2.work_order_id = bo.id AND bw2.status = 'completed'
                    ), 0) as completed_weight
                FROM blending_order bo
                WHERE DATE(bo.created_date) >= ?
                ORDER BY bo.created_date DESC
                LIMIT 10
            ''', (start_date,))

            orders = []
            for row in cursor.fetchall():
                work_order = row[0]
                product = row[1]
                target = row[2]
                completed = row[3]
                progress = round((completed / target * 100), 1) if target > 0 else 0

                orders.append({
                    'work_order': work_order,
                    'product': product,
                    'target': target,
                    'completed': completed,
                    'progress': progress
                })

            return jsonify({
                'success': True,
                'data': orders
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/dashboard/quality-rate', methods=['GET'])
def get_quality_rate():
    """검사 합격률 (도넛 차트용) - category 필터 지원"""
    try:
        from datetime import date, timedelta

        week_start = (date.today() - timedelta(days=date.today().weekday())).isoformat()
        category = request.args.get('category', '')  # 'incoming', 'mixing', or '' (all)

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            cat_filter = " AND category = ?" if category else ""
            params_base = [week_start] + ([category] if category else [])

            # 합격
            cursor.execute(f'''
                SELECT COUNT(*) FROM inspection_result
                WHERE DATE(inspection_time) >= ? AND final_result = 'PASS'{cat_filter}
            ''', params_base)
            passed = cursor.fetchone()[0]

            # 불합격
            cursor.execute(f'''
                SELECT COUNT(*) FROM inspection_result
                WHERE DATE(inspection_time) >= ? AND final_result = 'FAIL'{cat_filter}
            ''', params_base)
            failed = cursor.fetchone()[0]

            # 진행중 (final_result가 아직 NULL인 항목)
            cursor.execute(f'''
                SELECT COUNT(*) FROM inspection_result
                WHERE DATE(inspection_time) >= ? AND final_result IS NULL{cat_filter}
            ''', params_base)
            in_progress = cursor.fetchone()[0]

            return jsonify({
                'success': True,
                'data': {
                    'passed': passed,
                    'failed': failed,
                    'in_progress': in_progress
                }
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/dashboard/daily-trend', methods=['GET'])
def get_daily_trend():
    """최근 7일 검사 추이"""
    try:
        from datetime import date, timedelta

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            trend_data = []

            for i in range(6, -1, -1):
                target_date = (date.today() - timedelta(days=i)).isoformat()

                # 수입분말 검사
                cursor.execute('''
                    SELECT COUNT(*) FROM inspection_result
                    WHERE DATE(inspection_time) = ? AND category = 'incoming' AND final_result IS NOT NULL
                ''', (target_date,))
                incoming_count = cursor.fetchone()[0]

                # 배합분말 검사
                cursor.execute('''
                    SELECT COUNT(*) FROM inspection_result
                    WHERE DATE(inspection_time) = ? AND category = 'mixing' AND final_result IS NOT NULL
                ''', (target_date,))
                mixing_count = cursor.fetchone()[0]

                trend_data.append({
                    'date': target_date,
                    'incoming': incoming_count,
                    'mixing': mixing_count
                })

            return jsonify({
                'success': True,
                'data': trend_data
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/dashboard/powder-status', methods=['GET'])
def get_powder_status():
    """분말별 검사 현황 (이번주)"""
    try:
        from datetime import date, timedelta

        week_start = (date.today() - timedelta(days=date.today().weekday())).isoformat()

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            # 분말별 검사 통계
            cursor.execute('''
                SELECT
                    powder_name,
                    COUNT(*) as total,
                    SUM(CASE WHEN final_result = 'PASS' THEN 1 ELSE 0 END) as passed
                FROM inspection_result
                WHERE DATE(inspection_time) >= ? AND final_result IS NOT NULL
                GROUP BY powder_name
                ORDER BY total DESC
                LIMIT 8
            ''', (week_start,))

            powder_data = []
            for row in cursor.fetchall():
                powder_name = row[0]
                total = row[1]
                passed = row[2]
                failed = total - passed
                pass_rate = round((passed / total * 100), 1) if total > 0 else 0

                powder_data.append({
                    'powder': powder_name,
                    'total': total,
                    'passed': passed,
                    'failed': failed,
                    'pass_rate': pass_rate
                })

            return jsonify({
                'success': True,
                'data': powder_data
            })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


# ============================================
# 대시보드 신규 API (배합 중심)
# ============================================

@app.route('/api/dashboard/blending-completion', methods=['GET'])
def dashboard_blending_completion():
    """배합작업 완료현황 - 일별/주별/월별"""
    period = request.args.get('period', 'daily')
    try:
        from datetime import date, timedelta
        from calendar import monthrange
        today = datetime.now(ZoneInfo('Asia/Seoul')).date()

        with closing(get_db()) as conn:
            cursor = conn.cursor()
            results = []

            if period == 'daily':
                dates = [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
                cursor.execute("""
                    SELECT DATE(end_time) as day, COUNT(*) as cnt
                    FROM blending_work
                    WHERE status='completed' AND (is_hidden IS NULL OR is_hidden=0)
                    AND DATE(end_time) >= ?
                    GROUP BY day
                """, (dates[0],))
                data_map = {row[0]: row[1] for row in cursor.fetchall()}
                results = [{'label': d[5:].replace('-', '/'), 'count': data_map.get(d, 0)} for d in dates]

            elif period == 'weekly':
                monday = today - timedelta(days=today.weekday())
                weeks = [(monday - timedelta(weeks=i), monday - timedelta(weeks=i) + timedelta(days=6))
                         for i in range(6, -1, -1)]
                cursor.execute("""
                    SELECT DATE(end_time) as day, COUNT(*) as cnt
                    FROM blending_work
                    WHERE status='completed' AND (is_hidden IS NULL OR is_hidden=0)
                    AND DATE(end_time) >= ?
                    GROUP BY day
                """, (weeks[0][0].isoformat(),))
                day_map = {row[0]: row[1] for row in cursor.fetchall()}
                for ws, we in weeks:
                    count = sum(day_map.get((ws + timedelta(days=j)).isoformat(), 0) for j in range(7))
                    results.append({'label': f"{ws.month}/{ws.day}주", 'count': count})

            elif period == 'monthly':
                for i in range(6, -1, -1):
                    m = today.month - i
                    y = today.year
                    while m <= 0:
                        m += 12
                        y -= 1
                    ms = date(y, m, 1).isoformat()
                    me = date(y, m, monthrange(y, m)[1]).isoformat()
                    cursor.execute("""
                        SELECT COUNT(*) FROM blending_work
                        WHERE status='completed' AND (is_hidden IS NULL OR is_hidden=0)
                        AND DATE(end_time) >= ? AND DATE(end_time) <= ?
                    """, (ms, me))
                    results.append({'label': f"{y}/{m:02d}", 'count': cursor.fetchone()[0]})

            return jsonify({'success': True, 'data': results})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/dashboard/blending-by-powder', methods=['GET'])
def dashboard_blending_by_powder():
    """배합분말별 작업현황 - 오늘/주간/월간"""
    period = request.args.get('period', 'today')
    try:
        from datetime import date, timedelta
        today = datetime.now(ZoneInfo('Asia/Seoul')).date()

        with closing(get_db()) as conn:
            cursor = conn.cursor()

            if period == 'today':
                cursor.execute("""
                    SELECT product_name, COUNT(*) as cnt
                    FROM blending_work
                    WHERE (is_hidden IS NULL OR is_hidden=0)
                    AND DATE(COALESCE(end_time, start_time)) = ?
                    GROUP BY product_name ORDER BY cnt DESC LIMIT 10
                """, (today.isoformat(),))
            elif period == 'week':
                monday = (today - timedelta(days=today.weekday())).isoformat()
                cursor.execute("""
                    SELECT product_name, COUNT(*) as cnt
                    FROM blending_work
                    WHERE (is_hidden IS NULL OR is_hidden=0)
                    AND DATE(COALESCE(end_time, start_time)) >= ?
                    GROUP BY product_name ORDER BY cnt DESC LIMIT 10
                """, (monday,))
            else:
                month_start = date(today.year, today.month, 1).isoformat()
                cursor.execute("""
                    SELECT product_name, COUNT(*) as cnt
                    FROM blending_work
                    WHERE (is_hidden IS NULL OR is_hidden=0)
                    AND DATE(COALESCE(end_time, start_time)) >= ?
                    GROUP BY product_name ORDER BY cnt DESC LIMIT 10
                """, (month_start,))

            results = [{'powder': row[0], 'count': row[1]} for row in cursor.fetchall()]
            return jsonify({'success': True, 'data': results})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/dashboard/mixing-inspection', methods=['GET'])
def dashboard_mixing_inspection():
    """배합분말 검사현황 - 일별/주별/월별 (대상/완료/진행중)"""
    period = request.args.get('period', 'daily')
    try:
        from datetime import date, timedelta
        from calendar import monthrange
        today = datetime.now(ZoneInfo('Asia/Seoul')).date()

        with closing(get_db()) as conn:
            cursor = conn.cursor()
            results = []

            def fetch_day_map(query, param):
                cursor.execute(query, (param,))
                return {row[0]: row[1] for row in cursor.fetchall()}

            if period == 'daily':
                dates = [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
                target_map = fetch_day_map("""
                    SELECT DATE(inspection_time) as day, COUNT(*) FROM inspection_result
                    WHERE category='mixing' AND (is_hidden IS NULL OR is_hidden=0)
                    AND DATE(inspection_time) >= ? GROUP BY day
                """, dates[0])
                done_map = fetch_day_map("""
                    SELECT DATE(inspection_time) as day, COUNT(*) FROM inspection_result
                    WHERE category='mixing' AND final_result IN ('PASS','FAIL')
                    AND (is_hidden IS NULL OR is_hidden=0)
                    AND DATE(inspection_time) >= ? GROUP BY day
                """, dates[0])
                for d in dates:
                    t = target_map.get(d, 0)
                    c = done_map.get(d, 0)
                    results.append({'label': d[5:].replace('-', '/'), 'target': t,
                                    'completed': c, 'in_progress': max(0, t - c)})

            elif period == 'weekly':
                monday = today - timedelta(days=today.weekday())
                weeks = [(monday - timedelta(weeks=i), monday - timedelta(weeks=i) + timedelta(days=6))
                         for i in range(6, -1, -1)]
                start = weeks[0][0].isoformat()
                target_map = fetch_day_map("""
                    SELECT DATE(inspection_time), COUNT(*) FROM inspection_result
                    WHERE category='mixing' AND (is_hidden IS NULL OR is_hidden=0)
                    AND DATE(inspection_time) >= ? GROUP BY DATE(inspection_time)
                """, start)
                done_map = fetch_day_map("""
                    SELECT DATE(inspection_time), COUNT(*) FROM inspection_result
                    WHERE category='mixing' AND final_result IN ('PASS','FAIL')
                    AND (is_hidden IS NULL OR is_hidden=0)
                    AND DATE(inspection_time) >= ? GROUP BY DATE(inspection_time)
                """, start)
                for ws, we in weeks:
                    t = sum(target_map.get((ws + timedelta(days=j)).isoformat(), 0) for j in range(7))
                    c = sum(done_map.get((ws + timedelta(days=j)).isoformat(), 0) for j in range(7))
                    results.append({'label': f"{ws.month}/{ws.day}주", 'target': t,
                                    'completed': c, 'in_progress': max(0, t - c)})

            elif period == 'monthly':
                for i in range(6, -1, -1):
                    m = today.month - i
                    y = today.year
                    while m <= 0:
                        m += 12
                        y -= 1
                    ms = date(y, m, 1).isoformat()
                    me = date(y, m, monthrange(y, m)[1]).isoformat()
                    cursor.execute("""
                        SELECT COUNT(*) FROM inspection_result
                        WHERE category='mixing' AND (is_hidden IS NULL OR is_hidden=0)
                        AND DATE(inspection_time) >= ? AND DATE(inspection_time) <= ?
                    """, (ms, me))
                    t = cursor.fetchone()[0]
                    cursor.execute("""
                        SELECT COUNT(*) FROM inspection_result
                        WHERE category='mixing' AND final_result IN ('PASS','FAIL')
                        AND (is_hidden IS NULL OR is_hidden=0)
                        AND DATE(inspection_time) >= ? AND DATE(inspection_time) <= ?
                    """, (ms, me))
                    c = cursor.fetchone()[0]
                    results.append({'label': f"{y}/{m:02d}", 'target': t,
                                    'completed': c, 'in_progress': max(0, t - c)})

            return jsonify({'success': True, 'data': results})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})



# ============================================================
# Bot 연동 API
# ============================================================

@app.route('/api/bot/check-registered', methods=['POST'])
def bot_check_registered():
    """DriveFileId 목록을 받아 이미 등록된 것 반환 (bot_registered + inspection_result 양쪽 확인)"""
    try:
        data          = request.get_json()
        drive_file_ids = data.get('driveFileIds', [])
        if not drive_file_ids:
            return jsonify({'success': True, 'registered': []})

        with closing(get_db()) as conn:
            cursor = conn.cursor()
            placeholders = ','.join('?' * len(drive_file_ids))
            # bot_registered: 이번 수정 이후 등록된 건
            # inspection_result: 이전 방식으로 저장된 건 (drive_file_id가 있는 경우)
            cursor.execute(f'''
                SELECT drive_file_id FROM bot_registered
                WHERE drive_file_id IN ({placeholders})
                UNION
                SELECT drive_file_id FROM inspection_result
                WHERE drive_file_id IN ({placeholders})
                  AND drive_file_id IS NOT NULL AND drive_file_id != ''
            ''', drive_file_ids + drive_file_ids)
            registered = [row[0] for row in cursor.fetchall()]
        return jsonify({'success': True, 'registered': registered})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/bot/save-drive-file-id', methods=['POST'])
def bot_save_drive_file_id():
    """검사 등록 즉시 bot_registered에 기록 (검사 완료 여부와 무관하게 중복 방지)"""
    try:
        data          = request.get_json()
        powder_name   = data.get('powderName')
        lot_number    = data.get('lotNumber')
        drive_file_id = data.get('driveFileId')

        if not all([powder_name, lot_number, drive_file_id]):
            return jsonify({'success': False, 'message': '필수 파라미터 누락'})

        with closing(get_db()) as conn:
            cursor = conn.cursor()
            # bot_registered에 즉시 기록 (UNIQUE 제약으로 중복 무시)
            cursor.execute('''
                INSERT OR IGNORE INTO bot_registered (drive_file_id, powder_name, lot_number)
                VALUES (?, ?, ?)
            ''', (drive_file_id, powder_name, lot_number))
            # inspection_result에도 반영 (이미 생성된 경우)
            cursor.execute('''
                UPDATE inspection_result
                SET drive_file_id = ?
                WHERE powder_name = ? AND lot_number = ?
                  AND (drive_file_id IS NULL OR drive_file_id = '')
            ''', (drive_file_id, powder_name, lot_number))
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


# ============================================================
# Bot 연동 설정 API (Sheets ID / API Key 저장)
# ============================================================

@app.route('/api/bot-settings', methods=['GET'])
def get_bot_settings():
    """Bot 연동 Google 설정 조회"""
    try:
        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            ''')
            cursor.execute("SELECT key, value FROM app_settings WHERE key IN ('bot_sheets_id','bot_sheet_name','bot_drive_api_key')")
            rows     = cursor.fetchall()
            settings = {r[0]: r[1] for r in rows}
            return jsonify({
                'success': True,
                'data': {
                    'sheetsId':  settings.get('bot_sheets_id', ''),
                    'sheetName': settings.get('bot_sheet_name', 'MailLog'),
                    'apiKey':    settings.get('bot_drive_api_key', '')
                }
            })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/bot-settings', methods=['POST'])
def save_bot_settings():
    """Bot 연동 Google 설정 저장"""
    try:
        data       = request.get_json()
        sheets_id  = data.get('sheetsId', '').strip()
        sheet_name = data.get('sheetName', 'MailLog').strip()
        api_key    = data.get('apiKey', '').strip()

        with closing(get_db()) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            ''')
            for key, val in [('bot_sheets_id', sheets_id), ('bot_sheet_name', sheet_name), ('bot_drive_api_key', api_key)]:
                cursor.execute('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', (key, val))
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


if __name__ == '__main__':
    print("=" * 50)
    print("분말 검사 시스템 서버 시작")
    print("=" * 50)
    print("접속 주소: http://localhost:5000")
    print("내부 네트워크 접속: http://<이 PC의 IP>:5000")
    print("종료: Ctrl+C")
    print("=" * 50)

    app.run(host='0.0.0.0', port=5000, debug=True)
