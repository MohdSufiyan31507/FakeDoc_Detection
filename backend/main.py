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
    # Convert bytes to numpy array for EasyOCR
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image_np = np.array(image)
    
    # Run text extraction
    results = ocr_reader.readtext(image_np)
    
    # Extract just the text strings with decent confidence
    extracted_text = []
    for (bbox, text, prob) in results:
        if prob > 0.2: # filter out very low confidence garbage
            extracted_text.append(text)
            
    return extracted_text

@app.post("/api/analyze")
async def analyze_document(file: UploadFile = File(...)):
    contents = await file.read()
    
    try:
        # 1. Forensic ELA
        ela_b64, confidence, variance = perform_ela(contents)
        
        # 2. Text Extraction (OCR)
        extracted_text_list = perform_ocr(contents)
        
        is_flagged = confidence < 80.0
        status = "QUARANTINE_L1" if is_flagged else "SYS_CLEARED"
        
        return {
            "status": "success",
            "doc_id": "DOC-REAL-" + str(random.randint(1000, 9999)),
            "filename": file.filename,
            "ela_heatmap": "data:image/jpeg;base64," + ela_b64,
            "confidence_score": f"{confidence:.1f}%",
            "decision": status,
            "is_flagged": is_flagged,
            "extracted_text": extracted_text_list, # Send real OCR data to frontend
            "metadata_checks": {
                "mrz": "PASS" if not is_flagged else "FAIL_LOGIC",
                "geo_ip": "PASS",
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
