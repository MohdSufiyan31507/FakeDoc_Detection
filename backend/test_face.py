import cv2
import mediapipe as mp
from main import extract_face
img = cv2.imread(r'C:\Users\SAMSUNG\.gemini\antigravity\brain\daaa5d8b-dfc7-4a0f-a61d-8b700e0e6a80\.user_uploaded\media_1788052961962.png')
res = extract_face(img)
print('Success' if res else 'Fail')
