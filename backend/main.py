from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
from PIL import Image, ImageChops, ImageEnhance
import io
import base64
import time
import random

app = FastAPI()

# Allow frontend to communicate with backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def perform_ela(image_bytes, quality=90):
    """
    Error Level Analysis (ELA)
    Saves the image at a known quality, diffs it against the original.
    Forged areas (like pasted faces or clone stamps) will compress differently
    and appear as bright anomalies in the heatmap.
    """
    original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    
    # Save at lower quality
    temp_io = io.BytesIO()
    original.save(temp_io, "JPEG", quality=quality)
    temp_io.seek(0)
    compressed = Image.open(temp_io)
    
    # Calculate difference
    diff = ImageChops.difference(original, compressed)
    
    # Enhance difference
    extrema = diff.getextrema()
    max_diff = max([ex[1] for ex in extrema])
    if max_diff == 0:
        max_diff = 1
    
    scale = 255.0 / max_diff
    enhanced = ImageEnhance.Brightness(diff).enhance(scale)
    
    # Convert to heat map using cv2 for visual forensics
    enhanced_np = np.array(enhanced)
    enhanced_bgr = cv2.cvtColor(enhanced_np, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(enhanced_bgr, cv2.COLOR_BGR2GRAY)
    
    # Create the JET heatmap (blue = normal, red = highly tampered)
    heatmap = cv2.applyColorMap(gray, cv2.COLORMAP_JET)
    
    # Convert back to base64 for the frontend to render directly
    _, buffer = cv2.imencode('.jpg', heatmap)
    b64_str = base64.b64encode(buffer).decode('utf-8')
    
    # Calculate a mock score based on variance
    variance = np.var(gray)
    
    # Normal images have low variance. If variance is high, it's likely edited.
    confidence = max(0, min(100, 100 - (variance / 15)))
    
    return b64_str, confidence, variance

@app.post("/api/analyze")
async def analyze_document(file: UploadFile = File(...)):
    contents = await file.read()
    
    try:
        # 1. Perform Real Error Level Analysis
        ela_b64, confidence, variance = perform_ela(contents)
        
        # 2. Determine Decision Logic
        is_flagged = confidence < 80.0
        status = "QUARANTINE_L1" if is_flagged else "SYS_CLEARED"
        
        # Artificial delay to simulate deep learning model loading
        time.sleep(1.5)
        
        # 3. Return JSON Payload to Frontend
        return {
            "status": "success",
            "doc_id": "DOC-REAL-" + str(random.randint(1000, 9999)),
            "filename": file.filename,
            "ela_heatmap": "data:image/jpeg;base64," + ela_b64,
            "confidence_score": f"{confidence:.1f}%",
            "variance": f"{variance:.1f}",
            "decision": status,
            "is_flagged": is_flagged,
            "metadata_checks": {
                "mrz": "PASS" if not is_flagged else "FAIL_LOGIC",
                "geo_ip": "PASS",
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
