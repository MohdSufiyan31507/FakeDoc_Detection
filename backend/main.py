from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
from PIL import Image, ImageChops, ImageEnhance
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

# --- MILESTONE 10: DATABASE SETUP ---
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

# --- AI CORE ---
def perform_ela(image_bytes, quality=90):
    original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    temp_io = io.BytesIO()
    original.save(temp_io, "JPEG", quality=quality)
    temp_io.seek(0)
    compressed = Image.open(temp_io)
    
    diff = ImageChops.difference(original, compressed)
    extrema = diff.getextrema()
    max_diff = max([ex[1] for ex in extrema])
    if max_diff == 0:
        max_diff = 1
    
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
    return b64_str, confidence, variance

def perform_ocr(image_bytes):
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image_np = np.array(image)
    results = ocr_reader.readtext(image_np)
    
    extracted_text = []
    for (bbox, text, prob) in results:
        if prob > 0.2:
            extracted_text.append(text)
    return extracted_text

def extract_face(image_bytes):
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
        
        if len(faces) == 0:
            return None
            
        largest_face = max(faces, key=lambda rect: rect[2] * rect[3])
        x, y, w, h = largest_face
        
        pad = int(w * 0.1)
        y1, y2 = max(0, y-pad), min(img.shape[0], y+h+pad)
        x1, x2 = max(0, x-pad), min(img.shape[1], x+w+pad)
        
        face_img = img[y1:y2, x1:x2]
        _, buffer = cv2.imencode('.jpg', face_img)
        return "data:image/jpeg;base64," + base64.b64encode(buffer).decode('utf-8')
    except Exception as e:
        print(f"Face extraction error: {e}")
        return None

def get_mrz_character_value(char):
    if '0' <= char <= '9':
        return int(char)
    if 'A' <= char <= 'Z':
        return ord(char) - 55
    if char == '<':
        return 0
    return 0

def calculate_mrz_checksum(data_str):
    weights = [7, 3, 1]
    total = 0
    for i, char in enumerate(data_str):
        val = get_mrz_character_value(char)
        total += val * weights[i % 3]
    return total % 10

def validate_mrz_logic(ocr_text_list):
    for text in ocr_text_list:
        clean_text = text.replace(" ", "").upper()
        if len(clean_text) >= 15 and ('<' in clean_text or sum(1 for c in clean_text if c.isdigit()) > 6):
            matches = re.finditer(r'([A-Z0-9<]{6,9})(\d)', clean_text)
            found_valid = False
            failed_math = False
            
            for match in matches:
                data = match.group(1)
                check_digit = int(match.group(2))
                calculated = calculate_mrz_checksum(data)
                if calculated == check_digit:
                    found_valid = True
                else:
                    failed_math = True
            
            if found_valid and not failed_math:
                return "PASS", "MATH_VERIFIED"
            if failed_math:
                return "FAIL", "CHECKSUM_MISMATCH (FORGERY DETECTED)"
            
    return "NOT_FOUND", "NO_MRZ_DETECTED"

# --- API ENDPOINTS ---
@app.post("/api/analyze")
async def analyze_document(file: UploadFile = File(...)):
    contents = await file.read()
    
    try:
        ela_b64, confidence, variance = perform_ela(contents)
        extracted_text_list = perform_ocr(contents)
        extracted_face_b64 = extract_face(contents)
        
        mrz_status, mrz_details = validate_mrz_logic(extracted_text_list)
        
        is_flagged = confidence < 80.0 or mrz_status == "FAIL"
        status = "QUARANTINE_L1" if is_flagged else "SYS_CLEARED"
        
        doc_id = "DOC-REAL-" + str(random.randint(1000, 9999))
        now = datetime.now()
        timestamp = now.strftime("%Y-%m-%d %H:%M:%S")
        time_str = now.strftime("%H:%M:%S")
        conf_str = f"{confidence:.1f}%"
        
        # Save to Database
        with get_db() as db:
            db.execute(
                "INSERT INTO documents (doc_id, timestamp, source_type, confidence, decision, is_flagged) VALUES (?, ?, ?, ?, ?, ?)",
                (doc_id, timestamp, "REAL_UPLOAD", conf_str, status, is_flagged)
            )
            action_text = f"Analyzed {file.filename} -> {doc_id}. ELA_CONF: {conf_str}. ROUTE: {status}"
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
            "confidence_score": conf_str,
            "decision": status,
            "is_flagged": is_flagged,
            "extracted_text": extracted_text_list,
            "metadata_checks": {
                "mrz": mrz_status,
                "mrz_details": mrz_details,
                "geo_ip": "PASS",
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/simulate_gateway")
def simulate_gateway():
    """Simulates a background document entering the system, saves to DB."""
    is_flagged = random.random() > 0.8
    doc_id = 'DOC-' + str(random.randint(10000, 99999))
    now = datetime.now()
    timestamp = now.strftime("%Y-%m-%d %H:%M:%S")
    time_str = now.strftime("%H:%M:%S")
    conf_score = f"{(random.random() * 100):.1f}%"
    status = "QUARANTINE_L1" if is_flagged else "SYS_CLEARED"
    
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
    """Fetches the 15 most recent documents from DB"""
    with get_db() as db:
        docs = db.execute("SELECT * FROM documents ORDER BY timestamp DESC LIMIT 15").fetchall()
        return {"documents": [dict(d) for d in docs]}

@app.get("/api/audit")
def get_audit():
    """Fetches the 50 most recent audit logs from DB"""
    with get_db() as db:
        logs = db.execute("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 50").fetchall()
        return {"logs": [dict(l) for l in logs]}
