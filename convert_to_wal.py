#!/usr/bin/env python3
"""
기존 데이터베이스를 WAL 모드로 전환하는 스크립트
"""
import sqlite3
import os

DB_PATH = 'database.db'

def convert_to_wal():
    """데이터베이스를 WAL 모드로 전환"""

    if not os.path.exists(DB_PATH):
        print(f"❌ 데이터베이스 파일이 없습니다: {DB_PATH}")
        return False

    try:
        print("=" * 60)
        print("데이터베이스 WAL 모드 전환")
        print("=" * 60)

        conn = sqlite3.connect(DB_PATH, timeout=30.0)
        cursor = conn.cursor()

        # 현재 journal 모드 확인
        cursor.execute('PRAGMA journal_mode')
        current_mode = cursor.fetchone()[0]
        print(f"\n현재 Journal 모드: {current_mode}")

        # WAL 모드로 전환
        print("WAL 모드로 전환 중...")
        cursor.execute('PRAGMA journal_mode = WAL')
        new_mode = cursor.fetchone()[0]
        print(f"새 Journal 모드: {new_mode}")

        # busy_timeout 설정
        cursor.execute('PRAGMA busy_timeout = 30000')
        print("Busy timeout을 30초로 설정")

        # synchronous 모드 확인 및 최적화
        cursor.execute('PRAGMA synchronous')
        sync_mode = cursor.fetchone()[0]
        print(f"현재 Synchronous 모드: {sync_mode}")

        # WAL 모드에서는 NORMAL (1)이 적절
        cursor.execute('PRAGMA synchronous = NORMAL')
        print("Synchronous 모드를 NORMAL로 설정")

        # WAL checkpoint
        cursor.execute('PRAGMA wal_checkpoint(FULL)')
        print("WAL checkpoint 실행 완료")

        conn.commit()
        conn.close()

        print("\n✅ WAL 모드 전환 완료!")
        print("\n" + "=" * 60)
        print("변경사항:")
        print("  - Journal 모드: WAL")
        print("  - Busy timeout: 30000ms (30초)")
        print("  - Synchronous: NORMAL")
        print("=" * 60)
        print("\n서버를 재시작하여 변경사항을 적용하세요.")

        return True

    except Exception as e:
        print(f"\n❌ 오류 발생: {e}")
        return False

if __name__ == '__main__':
    convert_to_wal()
