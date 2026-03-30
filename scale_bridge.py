"""
scale_bridge.py - AND EP-22KA 저울 브릿지
COM4(RS-232) 에서 저울 데이터를 읽어 WebSocket(localhost:8765)으로 전달
"""

import asyncio
import serial
import re
import json
import sys
import threading
import logging
import websockets
from websockets.server import serve

# ── 설정 ──────────────────────────────────────────
COM_PORT   = 'COM4'
BAUD_RATE  = 2400
BYTESIZE   = serial.EIGHTBITS
PARITY     = serial.PARITY_NONE
STOP_BITS  = serial.STOPBITS_ONE
WS_PORT    = 8765
WS_HOST    = 'localhost'
# ──────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger(__name__)

# 현재 연결된 WebSocket 클라이언트 집합
connected_clients: set = set()

def parse_scale_data(raw: str) -> float | None:
    """
    AND EP-22KA 출력 파싱
    예시: "ST,+00000513  g" → 513.0
          "ST,-00000050  g" → -50.0
          "US,+00000100  g" → None (불안정, 무시)
    """
    raw = raw.strip()
    # ST(Stable) 일 때만 처리
    match = re.match(r'^ST,([+-]\d+)\s*g', raw)
    if not match:
        return None
    value = int(match.group(1))
    return float(value)


async def broadcast(message: dict):
    """연결된 모든 WebSocket 클라이언트에 메시지 전송"""
    if not connected_clients:
        return
    data = json.dumps(message, ensure_ascii=False)
    await asyncio.gather(
        *[client.send(data) for client in connected_clients],
        return_exceptions=True
    )


async def ws_handler(websocket):
    """WebSocket 연결 핸들러"""
    connected_clients.add(websocket)
    log.info(f"브라우저 연결됨 (총 {len(connected_clients)}개)")
    # 연결 즉시 현재 시리얼 상태 전송
    await websocket.send(json.dumps({'type': 'status', 'connected': serial_connected}))
    try:
        async for _ in websocket:
            pass  # 브라우저에서 오는 메시지는 무시
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        log.info(f"브라우저 연결 해제 (총 {len(connected_clients)}개)")


# 시리얼 연결 상태 (serial 스레드와 공유)
serial_connected = False


def serial_reader(loop: asyncio.AbstractEventLoop):
    """별도 스레드에서 COM 포트를 읽어 이벤트 루프로 전달"""
    global serial_connected

    while True:
        try:
            log.info(f"{COM_PORT} 연결 시도 중...")
            with serial.Serial(
                port=COM_PORT,
                baudrate=BAUD_RATE,
                bytesize=BYTESIZE,
                parity=PARITY,
                stopbits=STOP_BITS,
                timeout=2
            ) as ser:
                serial_connected = True
                log.info(f"{COM_PORT} 연결 성공")
                asyncio.run_coroutine_threadsafe(
                    broadcast({'type': 'status', 'connected': True}), loop
                )

                while True:
                    try:
                        line = ser.readline().decode('ascii', errors='ignore').strip()
                    except serial.SerialException:
                        break

                    if not line:
                        continue

                    log.debug(f"수신: {repr(line)}")
                    value = parse_scale_data(line)

                    if value is not None:
                        log.info(f"저울 값: {value} g")
                        asyncio.run_coroutine_threadsafe(
                            broadcast({'type': 'weight', 'value': value, 'unit': 'g'}),
                            loop
                        )

        except serial.SerialException as e:
            if serial_connected:
                serial_connected = False
                log.warning(f"저울 연결 끊김: {e}")
                asyncio.run_coroutine_threadsafe(
                    broadcast({'type': 'status', 'connected': False}), loop
                )
        except Exception as e:
            log.error(f"시리얼 오류: {e}")
            serial_connected = False

        # 재연결 대기
        import time
        time.sleep(3)


async def main():
    log.info(f"저울 브릿지 시작 - ws://{WS_HOST}:{WS_PORT}")
    loop = asyncio.get_running_loop()

    # 시리얼 읽기 스레드 시작
    t = threading.Thread(target=serial_reader, args=(loop,), daemon=True)
    t.start()

    # WebSocket 서버 시작
    async with serve(ws_handler, WS_HOST, WS_PORT):
        log.info(f"WebSocket 서버 대기 중: ws://{WS_HOST}:{WS_PORT}")
        await asyncio.Future()  # 무한 대기


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("종료")
        sys.exit(0)
