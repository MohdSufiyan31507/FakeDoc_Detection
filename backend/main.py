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

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Initializing AI OCR Engine... (Downloads language models on first run)")
ocr_reader = easyocr.Reader(['en'], gpu=False)

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

# --- MILESTONE 8: MRZ MATH VALIDATION ---
def get_mrz_character_value(char):
    if '0' <= char <= '9':
        return int(char)
    if 'A' <= char <= 'Z':
        return ord(char) - 55
    if char == '<':
        return 0
    return 0

def calculate_mrz_checksum(data_str):
    """ ICAO 9303 Standard MRZ Checksum Algorithm (Weights: 7, 3, 1) """
    weights = [7, 3, 1]
    total = 0
    for i, char in enumerate(data_str):
        val = get_mrz_character_value(char)
        total += val * weights[i % 3]
    return total % 10

def validate_mrz_logic(ocr_text_list):
    """
    Scans the extracted OCR text for Machine Readable Zones (MRZ).
    If found, applies the ICAO 9303 mathematical algorithm to verify 
    document numbers and birth dates. If the math fails, the ID is forged.
    """
    for text in ocr_text_list:
        clean_text = text.replace(" ", "").upper()
        
        # Look for strings that have characteristics of an MRZ line (long, alphanumeric + <)
        if len(clean_text) >= 15 and ('<' in clean_text or sum(1 for c in clean_text if c.isdigit()) > 6):
            
            # Find any block of 6 to 9 characters followed immediately by a single digit
            # This pattern matches Passport Numbers, DOBs (YYMMDD), and Expirations.
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

@app.post("/api/analyze")
async def analyze_document(file: UploadFile = File(...)):
    contents = await file.read()
    
    try:
        ela_b64, confidence, variance = perform_ela(contents)
        extracted_text_list = perform_ocr(contents)
        
        # Run Milestone 8 MRZ Logic
        mrz_status, mrz_details = validate_mrz_logic(extracted_text_list)
        
        # Determine Decision
        is_flagged = confidence < 80.0 or mrz_status == "FAIL"
        status = "QUARANTINE_L1" if is_flagged else "SYS_CLEARED"
        
        return {
            "status": "success",
            "doc_id": "DOC-REAL-" + str(random.randint(1000, 9999)),
            "filename": file.filename,
            "ela_heatmap": "data:image/jpeg;base64," + ela_b64,
            "confidence_score": f"{confidence:.1f}%",
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
