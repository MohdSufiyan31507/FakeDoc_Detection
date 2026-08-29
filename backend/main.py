from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ExifTags
import io
import base64
import time
import random
import easyocr
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Initializing AI OCR Engine... (Downloads language models on first run)")
ocr_reader = easyocr.Reader(['en'], gpu=False)

def init_db():
    conn = sqlite3.connect("fakedoc.db")
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            doc_id TEXT PRIMARY KEY,
            timestamp TEXT,
            source_type TEXT,
            confidence TEXT,
            decision TEXT,
            is_flagged BOOLEAN
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time_str TEXT,
            timestamp TEXT,
            actor TEXT,
            action TEXT
        )
    """)
    conn.commit()
    conn.close()

init_db()

@contextmanager
def get_db():
    conn = sqlite3.connect("fakedoc.db")
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


# ==========================================
# 1. DOCUMENT PREPROCESSING & NORMALIZATION
# ==========================================
def order_points(pts):
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect

def four_point_transform(image, pts):
    rect = order_points(pts)
    (tl, tr, br, bl) = rect
    widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    maxWidth = max(int(widthA), int(widthB))
    heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
    maxHeight = max(int(heightA), int(heightB))
    dst = np.array([[0, 0], [maxWidth - 1, 0], [maxWidth - 1, maxHeight - 1], [0, maxHeight - 1]], dtype="float32")
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, M, (maxWidth, maxHeight))

def preprocess_document(image_bytes):
    """Applies CLAHE, Denoising, and attempts Douglas-Peucker Perspective Unwarping."""
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    # CLAHE (Lighting Equalization)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    cl = clahe.apply(l)
    limg = cv2.merge((cl,a,b))
    img_clahe = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
    
    # NLM Denoising
    img_clean = cv2.fastNlMeansDenoisingColored(img_clahe, None, 10, 10, 7, 21)
    
    # Edge Detection & Unwarping
    gray = cv2.cvtColor(img_clean, cv2.COLOR_BGR2GRAY)
    edged = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 75, 200)
    contours, _ = cv2.findContours(edged.copy(), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
    
    doc_img = img_clean
    for c in contours:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4 and cv2.contourArea(approx) > (img.shape[0]*img.shape[1]*0.3):
            # Only unwarp if the contour is reasonably large
            doc_img = four_point_transform(img_clean, approx.reshape(4, 2))
            break
            
    return doc_img, img


# ==========================================
# 2. DIGITAL FORENSICS (ELA, EXIF, MOIRE)
# ==========================================
def perform_ela(cv_img, quality=90):
    original = Image.fromarray(cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB))
    temp_io = io.BytesIO()
    original.save(temp_io, "JPEG", quality=quality)
    temp_io.seek(0)
    compressed = Image.open(temp_io)
    
    diff = ImageChops.difference(original, compressed)
    extrema = diff.getextrema()
    max_diff = max([ex[1] for ex in extrema])
    if max_diff == 0: max_diff = 1
    scale = 255.0 / max_diff
    enhanced = ImageEnhance.Brightness(diff).enhance(scale)
    
    enhanced_np = np.array(enhanced)
    enhanced_bgr = cv2.cvtColor(enhanced_np, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(enhanced_bgr, cv2.COLOR_BGR2GRAY)
    
    heatmap = cv2.applyColorMap(gray, cv2.COLORMAP_JET)
    _, buffer = cv2.imencode('.jpg', heatmap)
    b64_str = base64.b64encode(buffer).decode('utf-8')
    
    variance = np.var(gray)
    confidence = max(0, min(100, 100 - (variance / 15)))
    return b64_str, confidence

def check_exif_metadata(image_bytes):
    """Inspects file headers for Photoshop, GIMP, etc."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        exif = img.getexif()
        if not exif:
            return "MISSING_EXIF (POSSIBLE_WIPE)", True
        
        for tag_id, value in exif.items():
            tag = ExifTags.TAGS.get(tag_id, tag_id)
            if tag == 'Software':
                val_lower = str(value).lower()
                if any(x in val_lower for x in ['photoshop', 'gimp', 'canva', 'illustrator', 'paint']):
                    return f"SOFTWARE_SIG_DETECTED ({value})", True
        return "CLEAN_EXIF", False
    except Exception:
        return "NO_EXIF_DATA", True

def detect_moire_fft(cv_img):
    """Screen Recapture / Moiré Detection via Fast Fourier Transform"""
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
    f = np.fft.fft2(gray)
    fshift = np.fft.fftshift(f)
    magnitude_spectrum = 20 * np.log(np.abs(fshift) + 1e-8)
    
    h, w = gray.shape
    cy, cx = h//2, w//2
    # Mask low frequencies
    magnitude_spectrum[cy-30:cy+30, cx-30:cx+30] = 0
    high_freq_energy = np.mean(magnitude_spectrum)
    
    is_recapture = high_freq_energy > 120 # Threshold for screen grids
    return "SCREEN_RECAPTURE_DETECTED" if is_recapture else "NATURAL_SURFACE", is_recapture


# ==========================================
# 3. OCR & BIOMETRICS
# ==========================================
def perform_ocr(cv_img):
    image_np = cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB)
    results = ocr_reader.readtext(image_np)
    extracted_text = [text for (bbox, text, prob) in results if prob > 0.2]
    return extracted_text

def extract_face(cv_img):
    try:
        gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
        face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
        
        if len(faces) == 0:
            return None
            
        largest_face = max(faces, key=lambda rect: rect[2] * rect[3])
        x, y, w, h = largest_face
        
        pad = int(w * 0.1)
        y1, y2 = max(0, y-pad), min(cv_img.shape[0], y+h+pad)
        x1, x2 = max(0, x-pad), min(cv_img.shape[1], x+w+pad)
        
        face_img = cv_img[y1:y2, x1:x2]
        _, buffer = cv2.imencode('.jpg', face_img)
        return "data:image/jpeg;base64," + base64.b64encode(buffer).decode('utf-8')
    except Exception as e:
        return None

def get_mrz_character_value(char):
    if '0' <= char <= '9': return int(char)
    if 'A' <= char <= 'Z': return ord(char) - 55
    if char == '<': return 0
    return 0

def calculate_mrz_checksum(data_str):
    weights = [7, 3, 1]
    total = 0
    for i, char in enumerate(data_str):
        total += get_mrz_character_value(char) * weights[i % 3]
    return total % 10

def validate_mrz_logic(ocr_text_list):
    for text in ocr_text_list:
        clean_text = text.replace(" ", "").upper()
        if len(clean_text) >= 15 and ('<' in clean_text or sum(1 for c in clean_text if c.isdigit()) > 6):
            matches = re.finditer(r'([A-Z0-9<]{6,9})(\d)', clean_text)
            found_valid, failed_math = False, False
            
            for match in matches:
                data = match.group(1)
                check_digit = int(match.group(2))
                if calculate_mrz_checksum(data) == check_digit:
                    found_valid = True
                else:
                    failed_math = True
            
            if found_valid and not failed_math: return "PASS", "MATH_VERIFIED"
            if failed_math: return "FAIL", "CHECKSUM_MISMATCH"
            
    return "NOT_FOUND", "NO_MRZ_DETECTED"

# ==========================================
# 6. SCORING & AGGREGATION ENGINE
# ==========================================
def calculate_final_risk(confidence, mrz_status, has_bad_exif, is_recapture):
    ela_risk = (100 - confidence) / 100 * 0.40
    mrz_risk = 0.40 if mrz_status == "FAIL" else 0.0
    exif_risk = 0.10 if has_bad_exif else 0.0
    moire_risk = 0.10 if is_recapture else 0.0
    
    total_risk = ela_risk + mrz_risk + exif_risk + moire_risk
    
    if total_risk > 0.65:
        return total_risk, "REJECTED"
    elif total_risk >= 0.25:
        return total_risk, "FLAGGED_FOR_REVIEW"
    else:
        return total_risk, "APPROVED"

@app.post("/api/analyze")
async def analyze_document(file: UploadFile = File(...)):
    contents = await file.read()
    
    try:
        # Phase 1: Preprocess (Unwarp, CLAHE, Denoise)
        doc_img, original_img = preprocess_document(contents)
        
        # Phase 2: Forensics
        ela_b64, confidence = perform_ela(doc_img)
        exif_details, has_bad_exif = check_exif_metadata(contents)
        moire_details, is_recapture = detect_moire_fft(doc_img)
        
        # Phase 3: OCR & Validation
        extracted_text_list = perform_ocr(doc_img)
        mrz_status, mrz_details = validate_mrz_logic(extracted_text_list)
        
        # Phase 4: Biometrics
        extracted_face_b64 = extract_face(doc_img)
        
        # Phase 5: Aggregation Engine
        risk_score, final_decision = calculate_final_risk(confidence, mrz_status, has_bad_exif, is_recapture)
        is_flagged = final_decision != "APPROVED"
        
        doc_id = "DOC-REAL-" + str(random.randint(1000, 9999))
        now = datetime.now()
        timestamp = now.strftime("%Y-%m-%d %H:%M:%S")
        time_str = now.strftime("%H:%M:%S")
        conf_str = f"RISK: {risk_score:.2f}"
        
        # Save to Database
        with get_db() as db:
            db.execute(
                "INSERT INTO documents (doc_id, timestamp, source_type, confidence, decision, is_flagged) VALUES (?, ?, ?, ?, ?, ?)",
                (doc_id, timestamp, "REAL_UPLOAD", conf_str, final_decision, is_flagged)
            )
            action_text = f"Analyzed {file.filename}. RISK: {risk_score:.2f}. ROUTE: {final_decision}"
            db.execute(
                "INSERT INTO audit_log (time_str, timestamp, actor, action) VALUES (?, ?, ?, ?)",
                (time_str, timestamp, "PYTHON_BACKEND", action_text)
            )
            db.commit()
        
        return {
            "status": "success",
            "doc_id": doc_id,
            "filename": file.filename,
            "ela_heatmap": "data:image/jpeg;base64," + ela_b64,
            "extracted_face": extracted_face_b64,
            "risk_score": f"{risk_score:.2f}",
            "decision": final_decision,
            "is_flagged": is_flagged,
            "extracted_text": extracted_text_list,
            "metadata_checks": {
                "mrz": mrz_status,
                "mrz_details": mrz_details,
                "exif": exif_details,
                "moire": moire_details
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/simulate_gateway")
def simulate_gateway():
    is_flagged = random.random() > 0.8
    doc_id = 'DOC-' + str(random.randint(10000, 99999))
    now = datetime.now()
    timestamp = now.strftime("%Y-%m-%d %H:%M:%S")
    time_str = now.strftime("%H:%M:%S")
    conf_score = f"RISK: {(random.random()):.2f}"
    status = "REJECTED" if is_flagged else "APPROVED"
    
    with get_db() as db:
        db.execute(
            "INSERT INTO documents (doc_id, timestamp, source_type, confidence, decision, is_flagged) VALUES (?, ?, ?, ?, ?, ?)",
            (doc_id, timestamp, "API_GATEWAY", conf_score, status, is_flagged)
        )
        action_text = f"Event {doc_id}. CONF: {conf_score}. ROUTE: {status}"
        db.execute(
            "INSERT INTO audit_log (time_str, timestamp, actor, action) VALUES (?, ?, ?, ?)",
            (time_str, timestamp, "SYS_GATE", action_text)
        )
        db.commit()
        
    return {"status": "success", "doc_id": doc_id}

@app.get("/api/stream")
def get_stream():
    with get_db() as db:
        docs = db.execute("SELECT * FROM documents ORDER BY timestamp DESC LIMIT 15").fetchall()
        return {"documents": [dict(d) for d in docs]}

@app.get("/api/audit")
def get_audit():
    with get_db() as db:
        logs = db.execute("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 50").fetchall()
        return {"logs": [dict(l) for l in logs]}
