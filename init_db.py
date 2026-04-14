"""
분말 검사 시스템 - 데이터베이스 초기화 스크립트
SQLite 데이터베이스를 생성하고 초기 테이블 및 샘플 데이터를 입력합니다.
"""

import sqlite3
import os

def init_database():
    """데이터베이스 초기화 및 테이블 생성"""

    # 스크립트 디렉토리 기반으로 데이터베이스 경로 설정
    script_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(script_dir, 'database.db')

    # 기존 DB 파일 삭제 (초기화)
    if os.path.exists(db_path):
        print("기존 데이터베이스 삭제 중...")
        os.remove(db_path)

    # 데이터베이스 연결
    conn = sqlite3.connect(db_path, timeout=30.0)
    cursor = conn.cursor()

    # WAL 모드 활성화 (동시성 향상)
    cursor.execute('PRAGMA journal_mode = WAL')
    cursor.execute('PRAGMA busy_timeout = 30000')

    print("데이터베이스 생성 중...")

    # 1. 분말 사양 테이블
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS powder_spec (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        powder_name TEXT UNIQUE NOT NULL,

        -- 유동도
        flow_rate_min REAL,
        flow_rate_max REAL,
        flow_rate_type TEXT,

        -- 겉보기밀도
        apparent_density_min REAL,
        apparent_density_max REAL,
        apparent_density_type TEXT,

        -- C함량
        c_content_min REAL,
        c_content_max REAL,
        c_content_type TEXT,

        -- Cu함량
        cu_content_min REAL,
        cu_content_max REAL,
        cu_content_type TEXT,

        -- 수분도
        moisture_min REAL,
        moisture_max REAL,
        moisture_type TEXT,

        -- 회분도
        ash_min REAL,
        ash_max REAL,
        ash_type TEXT,

        -- 소결변화율
        sinter_change_rate_min REAL,
        sinter_change_rate_max REAL,
        sinter_change_rate_type TEXT,

        -- 소결강도
        sinter_strength_min REAL,
        sinter_strength_max REAL,
        sinter_strength_type TEXT,

        -- 성형강도
        forming_strength_min REAL,
        forming_strength_max REAL,
        forming_strength_type TEXT,

        -- 성형하중
        forming_load_min REAL,
        forming_load_max REAL,
        forming_load_type TEXT,

        -- 입도분석
        particle_size_type TEXT,

        -- 검사 구분 (수입검사/배합검사)
        category VARCHAR(20) DEFAULT 'incoming'
    )
    ''')

    # 2. 검사 결과 테이블
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS inspection_result (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        powder_name TEXT NOT NULL,
        lot_number TEXT NOT NULL,
        inspector TEXT NOT NULL,
        inspection_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        inspection_type TEXT NOT NULL,

        -- 유동도
        flow_rate_1 REAL,
        flow_rate_2 REAL,
        flow_rate_3 REAL,
        flow_rate_avg REAL,
        flow_rate_result TEXT,

        -- 겉보기밀도 (원본 데이터)
        apparent_density_empty_cup_1 REAL,
        apparent_density_powder_weight_1 REAL,
        apparent_density_1 REAL,
        apparent_density_empty_cup_2 REAL,
        apparent_density_powder_weight_2 REAL,
        apparent_density_2 REAL,
        apparent_density_empty_cup_3 REAL,
        apparent_density_powder_weight_3 REAL,
        apparent_density_3 REAL,
        apparent_density_avg REAL,
        apparent_density_result TEXT,

        -- C함량
        c_content_1 REAL,
        c_content_2 REAL,
        c_content_3 REAL,
        c_content_avg REAL,
        c_content_result TEXT,

        -- Cu함량
        cu_content_1 REAL,
        cu_content_2 REAL,
        cu_content_3 REAL,
        cu_content_avg REAL,
        cu_content_result TEXT,

        -- 수분도 (원본 데이터)
        moisture_initial_weight_1 REAL,
        moisture_dried_weight_1 REAL,
        moisture_1 REAL,
        moisture_initial_weight_2 REAL,
        moisture_dried_weight_2 REAL,
        moisture_2 REAL,
        moisture_initial_weight_3 REAL,
        moisture_dried_weight_3 REAL,
        moisture_3 REAL,
        moisture_avg REAL,
        moisture_result TEXT,

        -- 회분도 (원본 데이터)
        ash_initial_weight_1 REAL,
        ash_ash_weight_1 REAL,
        ash_1 REAL,
        ash_initial_weight_2 REAL,
        ash_ash_weight_2 REAL,
        ash_2 REAL,
        ash_initial_weight_3 REAL,
        ash_ash_weight_3 REAL,
        ash_3 REAL,
        ash_avg REAL,
        ash_result TEXT,

        -- 소결변화율
        sinter_change_rate_1 REAL,
        sinter_change_rate_2 REAL,
        sinter_change_rate_3 REAL,
        sinter_change_rate_avg REAL,
        sinter_change_rate_result TEXT,

        -- 소결강도
        sinter_strength_1 REAL,
        sinter_strength_2 REAL,
        sinter_strength_3 REAL,
        sinter_strength_avg REAL,
        sinter_strength_result TEXT,

        -- 성형강도
        forming_strength_1 REAL,
        forming_strength_2 REAL,
        forming_strength_3 REAL,
        forming_strength_avg REAL,
        forming_strength_result TEXT,

        -- 성형하중
        forming_load_1 REAL,
        forming_load_2 REAL,
        forming_load_3 REAL,
        forming_load_avg REAL,
        forming_load_result TEXT,

        -- 입도분석
        particle_size_180_1 REAL,
        particle_size_180_2 REAL,
        particle_size_180_avg REAL,
        particle_size_180_result TEXT,

        particle_size_150_1 REAL,
        particle_size_150_2 REAL,
        particle_size_150_avg REAL,
        particle_size_150_result TEXT,

        particle_size_106_1 REAL,
        particle_size_106_2 REAL,
        particle_size_106_avg REAL,
        particle_size_106_result TEXT,

        particle_size_75_1 REAL,
        particle_size_75_2 REAL,
        particle_size_75_avg REAL,
        particle_size_75_result TEXT,

        particle_size_45_1 REAL,
        particle_size_45_2 REAL,
        particle_size_45_avg REAL,
        particle_size_45_result TEXT,

        particle_size_45m_1 REAL,
        particle_size_45m_2 REAL,
        particle_size_45m_avg REAL,
        particle_size_45m_result TEXT,

        particle_size_result TEXT,
        final_result TEXT,

        -- 검사 구분 (수입검사/배합검사)
        category VARCHAR(20) DEFAULT 'incoming',

        -- 검사일
        inspection_date DATE,

        UNIQUE(powder_name, lot_number)
    )
    ''')

    # 3. 진행중 검사 테이블
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS inspection_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        powder_name TEXT NOT NULL,
        lot_number TEXT NOT NULL,
        inspection_type TEXT NOT NULL,
        inspector TEXT NOT NULL,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_items TEXT,  -- JSON 배열
        total_items TEXT,      -- JSON 배열
        progress TEXT,

        -- 검사 구분 (수입검사/배합검사)
        category VARCHAR(20) DEFAULT 'incoming',

        -- 검사일
        inspection_date DATE,

        UNIQUE(powder_name, lot_number)
    )
    ''')

    # 4. 입도분석 규격 테이블
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS particle_size (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        powder_name TEXT NOT NULL,
        mesh_size TEXT NOT NULL,
        min_value REAL NOT NULL,
        max_value REAL NOT NULL,

        UNIQUE(powder_name, mesh_size)
    )
    ''')

    # 5. 검사자 테이블
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS inspector (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    )
    ''')

    # 6. 작업자 테이블
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS operator (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    )
    ''')

    # 7. Recipe (배합 규격서) 테이블
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS recipe (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name VARCHAR(100) NOT NULL,
        product_code VARCHAR(50),
        powder_name VARCHAR(100) NOT NULL,
        powder_category VARCHAR(20) DEFAULT 'incoming',
        ratio DECIMAL(5,2) NOT NULL,
        target_weight DECIMAL(10,3),
        tolerance_minus DECIMAL(10,2) DEFAULT 5,
        tolerance_plus DECIMAL(10,2) DEFAULT 5,
        is_main BOOLEAN DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(50)
    )
    ''')

    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_recipe_product
        ON recipe(product_name)
    ''')

    # 7-1. Product Spec (제품별 규격서/REV 관리) 테이블
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

    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_product_spec_name
        ON product_spec(product_name)
    ''')

    # 8. Blending Order (배합작업지시서) 테이블
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS blending_order (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_order_number VARCHAR(50) UNIQUE NOT NULL,
        product_name VARCHAR(100) NOT NULL,
        product_code VARCHAR(50),
        total_target_weight DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'in_progress',
        is_hidden INTEGER DEFAULT 0,
        hidden_at TIMESTAMP,
        hidden_by VARCHAR(50),
        created_by VARCHAR(50),
        created_date DATE DEFAULT (DATE('now')),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_blending_order_number
        ON blending_order(work_order_number)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_blending_order_status
        ON blending_order(status)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_blending_order_date
        ON blending_order(created_date)
    ''')

    # 9. Blending Work (배합 작업) 테이블
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS blending_work (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_order_id INTEGER REFERENCES blending_order(id) ON DELETE SET NULL,
        work_order VARCHAR(50),
        product_name VARCHAR(100) NOT NULL,
        product_code VARCHAR(50),
        batch_lot VARCHAR(50) UNIQUE NOT NULL,
        target_total_weight DECIMAL(10,2),
        actual_total_weight DECIMAL(10,2),
        blending_time INTEGER,
        blending_temperature DECIMAL(5,2),
        blending_rpm INTEGER,
        operator VARCHAR(50),
        status VARCHAR(20) DEFAULT 'in_progress',
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP,
        notes TEXT,
        main_powder_weights TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_blending_work_order_id
        ON blending_work(work_order_id)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_blending_batch_lot
        ON blending_work(batch_lot)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_blending_work_order
        ON blending_work(work_order)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_blending_status
        ON blending_work(status)
    ''')

    # 10. Material Input (원재료 투입) 테이블
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS material_input (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        blending_work_id INTEGER NOT NULL,
        powder_name VARCHAR(100) NOT NULL,
        powder_category VARCHAR(20) DEFAULT 'incoming',
        material_lot VARCHAR(50) NOT NULL,
        target_weight DECIMAL(10,3) NOT NULL,
        actual_weight DECIMAL(10,3) NOT NULL,
        weight_deviation DECIMAL(5,2),
        is_valid BOOLEAN DEFAULT 1,
        validation_message TEXT,
        input_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        input_by VARCHAR(50),
        FOREIGN KEY (blending_work_id) REFERENCES blending_work(id) ON DELETE CASCADE
    )
    ''')

    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_material_input_work
        ON material_input(blending_work_id)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_material_input_lot
        ON material_input(material_lot)
    ''')

    print("테이블 생성 완료!")

    # 초기 데이터는 비워둠 (사용자가 직접 입력)
    print("모든 테이블이 빈 상태로 생성되었습니다.")

    conn.commit()
    print("\n=== 데이터베이스 초기화 완료 ===")
    print("모든 테이블이 생성되었으며, 데이터는 비어있습니다.")

    conn.close()
    print("\n데이터베이스 파일: " + db_path)

if __name__ == '__main__':
    init_database()
