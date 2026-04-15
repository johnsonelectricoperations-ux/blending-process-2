"""
Bixolon 라벨 프린터 에이전트
- SLP-TX400 (작은 라벨, 40x30mm)
- XD5-401   (큰 라벨, 150x100mm)

로컬 PC에서 실행하며, 브라우저에서 HTTP로 인쇄 요청을 받습니다.
"""

import os
import sys
import json
import io
import time
import tempfile
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------
CONFIG_FILE = os.path.join(os.path.dirname(__file__), 'config.json')

DEFAULT_CONFIG = {
    "large_printer": "XD5-401",
    "small_printer": "SLP-TX400",
    "port": 9100
}

def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)
    return DEFAULT_CONFIG

# ---------------------------------------------------------------------------
# 라벨 이미지 생성 (PIL + qrcode)
# ---------------------------------------------------------------------------

def make_qr_image(text, size_px):
    import qrcode
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=4, border=2
    )
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    img = img.resize((size_px, size_px))
    return img


def build_large_label_image(data, dpi=203):
    """
    큰 라벨 (150mm x 100mm) PIL 이미지 생성
    XD5-401 기본 해상도 203dpi
    """
    from PIL import Image, ImageDraw, ImageFont

    mm_to_px = dpi / 25.4
    W = int(150 * mm_to_px)
    H = int(100 * mm_to_px)

    product  = data.get('productName', '')
    batch_lot= data.get('batchLot', '')
    pack_w   = data.get('packWeight', 0)
    pack_i   = data.get('packIndex', 1)
    total_p  = data.get('totalPacks', 1)
    copy_lbl = data.get('copyLabel', 'A')
    company  = "Johnson Electric Operations"

    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)

    # 폰트 (Windows 기본 폰트 사용)
    def get_font(size):
        for path in [
            r"C:\Windows\Fonts\arialbd.ttf",
            r"C:\Windows\Fonts\arial.ttf",
            r"/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            r"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]:
            if os.path.exists(path):
                try:
                    from PIL import ImageFont
                    return ImageFont.truetype(path, size)
                except Exception:
                    pass
        from PIL import ImageFont
        return ImageFont.load_default()

    margin = int(5 * mm_to_px)

    # 회사명
    font_company = get_font(int(5 * mm_to_px))
    draw.text((margin, margin), company, fill="black", font=font_company)

    # 제품명 (중앙 크게)
    font_product = get_font(int(22 * mm_to_px))
    bbox = draw.textbbox((0, 0), product, font=font_product)
    pw = bbox[2] - bbox[0]
    ph = bbox[3] - bbox[1]
    draw.text(((W - pw) // 2, (H - ph) // 2 - int(8 * mm_to_px)),
              product, fill="black", font=font_product)

    # Lot No
    font_lot = get_font(int(7 * mm_to_px))
    lot_text = f"Lot No : {batch_lot}"
    bbox2 = draw.textbbox((0, 0), lot_text, font=font_lot)
    lw = bbox2[2] - bbox2[0]
    draw.text(((W - lw) // 2, H - int(38 * mm_to_px)),
              lot_text, fill="black", font=font_lot)

    # QR 코드
    qr_size = int(25 * mm_to_px)
    qr_img = make_qr_image(f"{product}-{batch_lot}", qr_size)
    qr_x = (W - qr_size) // 2
    qr_y = H - int(28 * mm_to_px)
    img.paste(qr_img, (qr_x, qr_y))

    # 중량 / Pack 정보
    font_info = get_font(int(4.5 * mm_to_px))
    weight_text = f"Net Weight : {int(pack_w)}kg"
    pack_text   = f"Pack : {pack_i}/{total_p} ({copy_lbl})"
    draw.text((margin, H - int(5 * mm_to_px)), weight_text,
              fill="black", font=font_info)
    bbox3 = draw.textbbox((0, 0), pack_text, font=font_info)
    draw.text((W - margin - (bbox3[2] - bbox3[0]), H - int(5 * mm_to_px)),
              pack_text, fill="black", font=font_info)

    # 테두리
    draw.rectangle([0, 0, W-1, H-1], outline="black", width=3)

    return img


def build_small_label_image(data, dpi=203):
    """
    작은 라벨 (40mm x 30mm) PIL 이미지 생성
    SLP-TX400 기본 해상도 203dpi
    """
    from PIL import Image, ImageDraw, ImageFont

    mm_to_px = dpi / 25.4
    W = int(40 * mm_to_px)
    H = int(30 * mm_to_px)

    product  = data.get('productName', '')
    batch_lot= data.get('batchLot', '')

    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)

    def get_font(size):
        for path in [
            r"C:\Windows\Fonts\arialbd.ttf",
            r"C:\Windows\Fonts\arial.ttf",
            r"/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            r"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]:
            if os.path.exists(path):
                try:
                    from PIL import ImageFont
                    return ImageFont.truetype(path, size)
                except Exception:
                    pass
        from PIL import ImageFont
        return ImageFont.load_default()

    margin = int(1.5 * mm_to_px)

    # 제품명
    font_product = get_font(int(5 * mm_to_px))
    bbox = draw.textbbox((0, 0), product, font=font_product)
    pw = bbox[2] - bbox[0]
    draw.text(((W - pw) // 2, margin), product, fill="black", font=font_product)

    # QR 코드
    qr_size = int(13 * mm_to_px)
    qr_img = make_qr_image(f"{product}-{batch_lot}", qr_size)
    qr_x = (W - qr_size) // 2
    qr_y = int(7 * mm_to_px)
    img.paste(qr_img, (qr_x, qr_y))

    # LOT
    font_lot = get_font(int(3 * mm_to_px))
    lot_text = f"LOT: {batch_lot}"
    bbox2 = draw.textbbox((0, 0), lot_text, font=font_lot)
    lw = bbox2[2] - bbox2[0]
    draw.text(((W - lw) // 2, H - margin - (bbox2[3] - bbox2[1])),
              lot_text, fill="black", font=font_lot)

    draw.rectangle([0, 0, W-1, H-1], outline="black", width=2)

    return img


# ---------------------------------------------------------------------------
# 프린터로 이미지 전송 (win32print / GDI)
# ---------------------------------------------------------------------------

def send_image_to_printer(pil_image, printer_name):
    """PIL 이미지를 지정된 Windows 프린터로 직접 출력"""
    try:
        import win32print
        import win32ui
        import win32con
        from PIL import ImageWin

        hDC = win32ui.CreateDC()
        hDC.CreatePrinterDC(printer_name)

        printable_w = hDC.GetDeviceCaps(win32con.HORZRES)
        printable_h = hDC.GetDeviceCaps(win32con.VERTRES)

        img = pil_image.resize((printable_w, printable_h)).convert("RGB")

        hDC.StartDoc("Label")
        hDC.StartPage()
        dib = ImageWin.Dib(img)
        dib.draw(hDC.GetHandleOutput(), (0, 0, printable_w, printable_h))
        hDC.EndPage()
        hDC.EndDoc()
        hDC.DeleteDC()
        return True, "OK"

    except ImportError:
        return False, "pywin32가 설치되지 않았습니다. (pip install pywin32)"
    except Exception as e:
        return False, str(e)


# ---------------------------------------------------------------------------
# HTTP 핸들러
# ---------------------------------------------------------------------------

class PrintHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        print(f"[요청] {args[0]} {args[1]}")

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path == '/status':
            cfg = load_config()
            self.send_json(200, {
                'success': True,
                'large_printer': cfg['large_printer'],
                'small_printer': cfg['small_printer']
            })
        else:
            self.send_json(404, {'success': False, 'message': 'Not found'})

    def do_POST(self):
        if self.path == '/print':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body.decode('utf-8'))
            except Exception:
                self.send_json(400, {'success': False, 'message': '잘못된 JSON'})
                return

            cfg = load_config()
            results = {}

            # 큰 라벨 출력
            print(f"[인쇄] 큰 라벨 → {cfg['large_printer']}")
            large_img = build_large_label_image(data)
            ok, msg = send_image_to_printer(large_img, cfg['large_printer'])
            results['large'] = 'OK' if ok else f'실패: {msg}'
            print(f"[결과] 큰 라벨: {results['large']}")

            # 작은 라벨 출력
            print(f"[인쇄] 작은 라벨 → {cfg['small_printer']}")
            small_img = build_small_label_image(data)
            ok2, msg2 = send_image_to_printer(small_img, cfg['small_printer'])
            results['small'] = 'OK' if ok2 else f'실패: {msg2}'
            print(f"[결과] 작은 라벨: {results['small']}")

            success = 'OK' in results['large'] and 'OK' in results['small']
            self.send_json(200, {'success': success, 'results': results})

        elif self.path == '/config':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                new_cfg = json.loads(body.decode('utf-8'))
                cfg = load_config()
                cfg.update(new_cfg)
                with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
                self.send_json(200, {'success': True, 'message': '설정이 저장되었습니다.'})
            except Exception as e:
                self.send_json(500, {'success': False, 'message': str(e)})
        else:
            self.send_json(404, {'success': False, 'message': 'Not found'})


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    cfg = load_config()
    port = cfg.get('port', 9100)

    print("=" * 50)
    print("  빅슬론 라벨 프린터 에이전트")
    print("=" * 50)
    print(f"  큰 라벨 프린터 : {cfg['large_printer']}")
    print(f"  작은 라벨 프린터: {cfg['small_printer']}")
    print(f"  포트           : {port}")
    print(f"  상태 확인      : http://localhost:{port}/status")
    print("=" * 50)
    print("  종료하려면 Ctrl+C 를 누르세요.")
    print()

    # Windows 설치된 프린터 목록 출력
    try:
        import win32print
        printers = [p[2] for p in win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS)]
        print("  [설치된 프린터 목록]")
        for p in printers:
            print(f"    - {p}")
        print("=" * 50)
    except Exception:
        pass
    print()

    server = HTTPServer(('127.0.0.1', port), PrintHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n에이전트를 종료합니다.")
