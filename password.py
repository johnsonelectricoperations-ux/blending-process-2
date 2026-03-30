#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
분말 검사 시스템 - 비밀번호 관리 스크립트
프롬프트에서 실행하여 비밀번호를 변경합니다.

비밀번호 종류:
  1) 관리자 모드 진입용 (admin_password.txt) - 초기: admin1234
"""

import hashlib
import os
import getpass

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# 비밀번호 설정 정보
PASSWORD_CONFIG = {
    'admin_mode': {
        'file': os.path.join(SCRIPT_DIR, 'admin_password.txt'),
        'default': 'admin1234',
        'label': '관리자 모드 진입',
    },
}


def _change_password(config):
    """비밀번호 변경 공통 함수"""
    label = config['label']
    password_file = config['file']
    default_pw = config['default']

    print(f"\n{'=' * 60}")
    print(f"  [{label}] 비밀번호 변경")
    print(f"{'=' * 60}\n")

    # 현재 비밀번호 확인
    if os.path.exists(password_file):
        print("1단계: 현재 비밀번호 확인")
        current_password = getpass.getpass("현재 비밀번호를 입력하세요: ")

        with open(password_file, 'r') as f:
            stored_hash = f.read().strip()

        current_hash = hashlib.sha256(current_password.encode()).hexdigest()

        if current_hash != stored_hash:
            print("\n❌ 오류: 현재 비밀번호가 일치하지 않습니다.")
            return

        print("✓ 현재 비밀번호 확인 완료\n")
    else:
        print(f"⚠️  비밀번호 파일이 없습니다. 새로운 비밀번호를 설정합니다.\n")

    # 새 비밀번호 입력
    print("2단계: 새 비밀번호 설정")
    while True:
        new_password = getpass.getpass("새 비밀번호를 입력하세요: ")

        if len(new_password) < 4:
            print("❌ 비밀번호는 최소 4자 이상이어야 합니다.")
            continue

        confirm_password = getpass.getpass("새 비밀번호를 다시 입력하세요: ")

        if new_password != confirm_password:
            print("❌ 비밀번호가 일치하지 않습니다. 다시 입력해주세요.")
            continue

        break

    new_hash = hashlib.sha256(new_password.encode()).hexdigest()
    with open(password_file, 'w') as f:
        f.write(new_hash)

    print(f"\n{'=' * 60}")
    print(f"✅ [{label}] 비밀번호가 성공적으로 변경되었습니다!")
    print(f"{'=' * 60}\n")


def _reset_password(config):
    """비밀번호 초기화 공통 함수"""
    label = config['label']
    password_file = config['file']
    default_pw = config['default']

    print(f"\n{'=' * 60}")
    print(f"  [{label}] 비밀번호 초기화")
    print(f"{'=' * 60}\n")

    confirm = input(f"⚠️  비밀번호를 초기 상태({default_pw})로 리셋하시겠습니까? (yes/no): ")

    if confirm.lower() != 'yes':
        print("취소되었습니다.")
        return

    hashed = hashlib.sha256(default_pw.encode()).hexdigest()
    with open(password_file, 'w') as f:
        f.write(hashed)

    print(f"\n{'=' * 60}")
    print(f"✅ [{label}] 비밀번호가 초기화되었습니다!")
    print(f"{'=' * 60}")
    print(f"\n초기 비밀번호: {default_pw}")
    print("보안을 위해 즉시 비밀번호를 변경하시기 바랍니다.\n")


def main():
    """메인 함수"""

    while True:
        print()
        print("=" * 60)
        print("  분말 검사 시스템 - 비밀번호 관리")
        print("=" * 60)
        print()
        print("  [관리자 모드 진입용] admin_password.txt  (초기: admin1234)")
        print()
        print("  1. 관리자 모드 진입 비밀번호 변경")
        print("  2. 관리자 모드 진입 비밀번호 초기화 (admin1234)")
        print("  3. 종료")
        print()

        choice = input("  선택하세요 (1-3): ").strip()

        if choice == '1':
            _change_password(PASSWORD_CONFIG['admin_mode'])
        elif choice == '2':
            _reset_password(PASSWORD_CONFIG['admin_mode'])
        elif choice == '3':
            print("\n프로그램을 종료합니다.\n")
            break
        else:
            print("\n잘못된 선택입니다.")


if __name__ == '__main__':
    main()
