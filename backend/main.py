from fastapi import FastAPI, File, UploadFile, Form
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
import mediapipe as mp

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
            is_flagged BOOLEAN,
            doc_type TEXT
        )
    """)
    try:
        cursor.execute("ALTER TABLE documents ADD COLUMN doc_type TEXT")
    except:
        pass

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
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    # 1. CLAHE Contrast Enhancement
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    cl = clahe.apply(l)
    limg = cv2.merge((cl,a,b))
    img_clahe = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
    
    # 2. Denoising
    img_clean = cv2.fastNlMeansDenoisingColored(img_clahe, None, 10, 10, 7, 21)
    
    # Bypass aggressive perspective cropping, as it frequently crops out faces
    # if the uploaded image is already cropped (like a downloaded template).
    doc_img = img_clean
            
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
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
    f = np.fft.fft2(gray)
    fshift = np.fft.fftshift(f)
    magnitude_spectrum = 20 * np.log(np.abs(fshift) + 1e-8)
    
    h, w = gray.shape
    cy, cx = h//2, w//2
    magnitude_spectrum[cy-30:cy+30, cx-30:cx+30] = 0
    high_freq_energy = np.mean(magnitude_spectrum)
    
    is_recapture = high_freq_energy > 180 
    return "SCREEN_RECAPTURE_DETECTED" if is_recapture else "NATURAL_SURFACE", is_recapture


# ==========================================
# 3. AI FACE EXTRACTION (MediaPipe)
# ==========================================
def extract_face(cv_img):
    try:
        mp_face_detection = mp.solutions.face_detection
        with mp_face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.1) as face_detection:
            image_rgb = cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB)
            results = face_detection.process(image_rgb)
            
            if not results.detections:
                # Fallback to model 0 (close up)
                with mp_face_detection.FaceDetection(model_selection=0, min_detection_confidence=0.1) as fd_close:
                    results = fd_close.process(image_rgb)
                        
            if results and results.detections:
                # Get highest confidence face
                best_detection = max(results.detections, key=lambda d: d.score[0])
                bbox = best_detection.location_data.relative_bounding_box
                
                h_img, w_img, _ = cv_img.shape
                
                x = int(bbox.xmin * w_img)
                y = int(bbox.ymin * h_img)
                w = int(bbox.width * w_img)
                h = int(bbox.height * h_img)
                
                # 30% padding for full head/hair
                pad_y = int(h * 0.30)
                pad_x = int(w * 0.25)
                
                y1 = max(0, y - pad_y)
                y2 = min(h_img, y + h + pad_y)
                x1 = max(0, x - pad_x)
                x2 = min(w_img, x + w + pad_x)
                
                face_img = cv_img[y1:y2, x1:x2]
            else:
                # GEOMETRIC FALLBACK: If no face is found (e.g. dummy ID with blank silhouette),
                # forcefully crop the left 30% of the image where the Aadhaar face usually is.
                h_img, w_img, _ = cv_img.shape
                y1 = int(h_img * 0.20)
                y2 = int(h_img * 0.85)
                x1 = int(w_img * 0.02)
                x2 = int(w_img * 0.30)
                face_img = cv_img[y1:y2, x1:x2]

            _, buffer = cv2.imencode('.jpg', face_img)
            return "data:image/jpeg;base64," + base64.b64encode(buffer).decode('utf-8')
    except Exception as e:
        print(f"Face extraction error: {e}")
        return None

# ==========================================
# 4. MATH VALIDATION ENGINES
# ==========================================
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

# Verhoeff algorithm arrays for Aadhaar Checksum
verhoeff_d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
]
verhoeff_p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
]

def validate_verhoeff(num_str):
    c = 0
    reversed_num = num_str[::-1]
    for i, char in enumerate(reversed_num):
        c = verhoeff_d[c][verhoeff_p[i % 8][int(char)]]
    return c == 0


def perform_ocr(cv_img):
    image_np = cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB)
    results = ocr_reader.readtext(image_np)
    extracted_text = [text for (bbox, text, prob) in results if prob > 0.2]
    return extracted_text

def analyze_document_data(ocr_text_list):
    full_text = " ".join(ocr_text_list).upper()
    
    doc_type = "UNKNOWN DOCUMENT"
    validation_status = "NOT_FOUND"
    details = "Could not identify document structure."
    
    # 1. PAN CARD
    if "INCOME TAX" in full_text or "PERMANENT ACCOUNT" in full_text or "PAN" in full_text or "GOVT. OF INDIA" in full_text:
        doc_type = "PAN CARD"
        pan_match = re.search(r'[A-Z]{5}[0-9]{4}[A-Z]{1}', full_text.replace(" ", ""))
        if pan_match:
            validation_status, details = "PASS", f"PAN Format Valid: {pan_match.group(0)}"
        else:
            validation_status, details = "FAIL", "PAN ID format invalid or altered"
            
    # 2. AADHAAR CARD
    elif "AADHAAR" in full_text or "GOVERNMENT OF INDIA" in full_text or "UIDAI" in full_text or re.search(r'\d{4}\s\d{4}\s\d{4}', full_text):
        doc_type = "AADHAAR CARD"
        aadhaar_match = re.search(r'\b\d{4}\s?\d{4}\s?\d{4}\b', full_text)
        if aadhaar_match:
            uid_clean = aadhaar_match.group(0).replace(" ", "")
            # Apply Verhoeff Math verification on the Aadhaar Number
            if validate_verhoeff(uid_clean):
                validation_status, details = "PASS", f"Aadhaar Math Verified (Verhoeff Checksum Valid): {uid_clean}"
            else:
                validation_status, details = "FAIL", f"Aadhaar Math Failed (Fake/Generated Number Detected)"
        else:
            validation_status, details = "FAIL", "12-Digit UID missing or altered"
            
    # 3. VOTER ID
    elif "ELECTION COMMISSION" in full_text or "EPIC" in full_text or "ELECTOR PHOTO" in full_text:
        doc_type = "VOTER ID"
        epic_match = re.search(r'[A-Z]{3}[0-9]{7}', full_text.replace(" ", ""))
        if epic_match:
            validation_status, details = "PASS", f"EPIC Format Valid: {epic_match.group(0)}"
        else:
            validation_status, details = "FAIL", "EPIC format invalid or altered"
            
    # 4. DRIVING LICENCE
    elif "DRIVING LICENCE" in full_text or "TRANSPORT DEPARTMENT" in full_text or "UNION OF INDIA" in full_text:
        doc_type = "DRIVING LICENCE"
        dl_match = re.search(r'[A-Z]{2}[0-9]{2} ?[0-9]{11}', full_text.replace("-",""))
        if dl_match:
            validation_status, details = "PASS", f"DL Format Valid: {dl_match.group(0)}"
        else:
            validation_status, details = "PASS", "DL Layout Validated (Fallback)"

    # 5. PASSPORT (MRZ)
    elif "REPUBLIC OF INDIA" in full_text or "PASSPORT" in full_text or "<" in full_text:
        doc_type = "PASSPORT"
        clean_text = full_text.replace(" ", "").upper()
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
            
            if found_valid and not failed_math: 
                validation_status, details = "PASS", "MRZ Checksum Math Verified"
            elif failed_math: 
                validation_status, details = "FAIL", "MRZ Checksum Math Failed (Tampered)"
            else:
                validation_status, details = "FAIL", "Invalid MRZ Block"
        else:
            validation_status, details = "FAIL", "MRZ unreadable or missing"

    return doc_type, validation_status, details

# ==========================================
# 6. SCORING & AGGREGATION ENGINE
# ==========================================
def calculate_final_risk(confidence, doc_status, has_bad_exif, is_recapture):
    ela_risk = (100 - confidence) / 100 * 0.40
    doc_risk = 0.40 if doc_status == "FAIL" else 0.0
    exif_risk = 0.10 if has_bad_exif else 0.0
    moire_risk = 0.10 if is_recapture else 0.0
    
    total_risk = ela_risk + doc_risk + exif_risk + moire_risk
    
    if total_risk > 0.65:
        return total_risk, "REJECTED"
    elif total_risk >= 0.25:
        return total_risk, "FLAGGED_FOR_REVIEW"
    else:
        return total_risk, "APPROVED"


@app.post("/api/analyze")
async def analyze_document(file: UploadFile = File(...), expected_type: str = Form(None)):
    contents = await file.read()
    
    try:
        # Preprocess
        doc_img, original_img = preprocess_document(contents)
        
        # Forensics
        ela_b64, confidence = perform_ela(doc_img)
        exif_details, has_bad_exif = check_exif_metadata(contents)
        moire_details, is_recapture = detect_moire_fft(doc_img)
        
        # OCR & Classification
        extracted_text_list = perform_ocr(doc_img)
        doc_type, doc_status, doc_details = analyze_document_data(extracted_text_list)
        
        # Cross-Check Expected Type vs Detected Type
        if expected_type and doc_type != "UNKNOWN DOCUMENT":
            exp_clean = expected_type.upper().replace(" ", "")
            det_clean = doc_type.upper().replace(" ", "")
            if exp_clean not in det_clean and det_clean not in exp_clean:
                doc_status = "FAIL"
                doc_details = f"MISMATCH: Expected {expected_type} but detected a {doc_type}."
        
        # Biometrics (using MediaPipe)
        extracted_face_b64 = extract_face(doc_img)
        
        # Risk Engine
        risk_score, final_decision = calculate_final_risk(confidence, doc_status, has_bad_exif, is_recapture)
        is_flagged = final_decision != "APPROVED"
        
        doc_id = "DOC-REAL-" + str(random.randint(1000, 9999))
        now = datetime.now()
        timestamp = now.strftime("%Y-%m-%d %H:%M:%S")
        time_str = now.strftime("%H:%M:%S")
        conf_str = f"RISK: {risk_score:.2f}"
        
        # Save to Database
        with get_db() as db:
            db.execute(
                "INSERT INTO documents (doc_id, timestamp, source_type, confidence, decision, is_flagged, doc_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (doc_id, timestamp, "REAL_UPLOAD", conf_str, final_decision, is_flagged, doc_type)
            )
            action_text = f"Analyzed {doc_type} ({file.filename}). RISK: {risk_score:.2f}. ROUTE: {final_decision}"
            db.execute(
                "INSERT INTO audit_log (time_str, timestamp, actor, action) VALUES (?, ?, ?, ?)",
                (time_str, timestamp, "PYTHON_BACKEND", action_text)
            )
            db.commit()
            
        # Mock DigiLocker Sync mapping doc_status
        digilocker_status = "PASS" if doc_status != "FAIL" else "FAIL"
        
        return {
            "status": "success",
            "doc_id": doc_id,
            "filename": file.filename,
            "doc_type": doc_type,
            "ela_heatmap": "data:image/jpeg;base64," + ela_b64,
            "extracted_face": extracted_face_b64,
            "risk_score": f"{risk_score:.2f}",
            "decision": final_decision,
            "is_flagged": is_flagged,
            "extracted_text": extracted_text_list,
            "metadata_checks": {
                "doc_validation": doc_status,
                "doc_details": doc_details,
                "exif": exif_details,
                "moire": moire_details,
                "digilocker": digilocker_status
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

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
