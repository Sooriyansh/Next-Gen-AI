import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from config import CONFIDENCE_MARGIN, CONFIDENCE_THRESHOLD, EMBEDDINGS_PATH
from liveness_detection import LivenessDetector
from utils import (
    build_embedding_model,
    compute_embedding,
    cosine_similarity,
    detect_largest_face,
    extract_face_tensor,
    get_face_detector,
)


def parse_args():
    parser = argparse.ArgumentParser(description="Recognize a face from a single image with liveness check")
    parser.add_argument("--image", required=True, help="Path to the image file")
    parser.add_argument(
        "--check-liveness",
        action="store_true",
        help="Enable liveness check (checks if image is a photo/screen spoof)"
    )
    return parser.parse_args()


def load_embeddings():
    if not EMBEDDINGS_PATH.exists():
        raise RuntimeError("Embeddings file not found. Run train_model.py first.")

    data = np.load(EMBEDDINGS_PATH, allow_pickle=True)
    return data["labels"], data["embeddings"]


def find_best_match(embedding, labels, embeddings):
    label_scores = {}

    for label, stored in zip(labels, embeddings):
        score = cosine_similarity(embedding, stored)
        label = str(label)
        label_scores[label] = max(label_scores.get(label, 0.0), float(score))

    if not label_scores:
        return None, 0.0, 0.0

    ranked_scores = sorted(label_scores.items(), key=lambda item: item[1], reverse=True)
    best_label, best_score = ranked_scores[0]
    second_score = ranked_scores[1][1] if len(ranked_scores) > 1 else 0.0
    return best_label, float(best_score), float(second_score)


def check_static_image_liveness(image: np.ndarray) -> dict:
    """
    Perform static image liveness check
    For static images, we can detect spoof patterns like:
    - Color distribution (photos have more natural color variation)
    - Texture patterns (screens have repetitive patterns)
    - Frequency domain analysis
    
    Args:
        image: Input image (BGR format)
        
    Returns:
        Liveness check results dictionary
    """
    results = {
        "is_live": False,
        "confidence": 0.0,
        "checks": {
            "texture_analysis": False,
            "color_distribution": False,
            "frequency_analysis": False
        }
    }
    
    # Convert to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    
    # Check 1: Texture Analysis using Laplacian variance
    # Live faces have natural texture variation
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    results["checks"]["texture_analysis"] = laplacian_var > 100  # Threshold for natural texture
    texture_score = min(laplacian_var / 500, 1.0)  # Normalize
    
    # Check 2: Color Distribution Analysis
    # Photos typically have more color variation than screens
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    h_channel = hsv[:, :, 0]
    s_channel = hsv[:, :, 1]
    v_channel = hsv[:, :, 2]
    
    # Calculate color diversity
    h_std = cv2.calcHist([h_channel], [0], None, [256], [0, 256]).flatten().std()
    s_std = cv2.calcHist([s_channel], [0], None, [256], [0, 256]).flatten().std()
    
    color_diversity = (h_std + s_std) / 2
    results["checks"]["color_distribution"] = color_diversity > 15  # Threshold for color variation
    color_score = min(color_diversity / 50, 1.0)  # Normalize
    
    # Check 3: Frequency Domain Analysis using FFT
    # Real faces have more natural frequency distribution
    f_transform = np.fft.fft2(gray)
    f_shift = np.fft.fftshift(f_transform)
    magnitude_spectrum = np.abs(f_shift)
    
    # Calculate power spectrum distribution
    total_power = np.sum(magnitude_spectrum ** 2)
    center = magnitude_spectrum[h//4:3*h//4, w//4:3*w//4]
    center_power = np.sum(center ** 2)
    
    # Real faces have power distributed across frequencies
    # Photos have different distribution than screens
    power_concentration = center_power / (total_power + 1e-6)
    results["checks"]["frequency_analysis"] = 0.3 < power_concentration < 0.95
    freq_score = 1.0 - abs(power_concentration - 0.6) / 0.35  # Peaks around 0.6
    
    # Overall liveness decision
    checks_passed = sum(results["checks"].values())
    
    if checks_passed >= 2:  # At least 2 checks must pass
        results["is_live"] = True
        results["confidence"] = (texture_score + color_score + freq_score) / 3
    else:
        results["is_live"] = False
        results["confidence"] = (texture_score + color_score + freq_score) / 3
    
    return results


def main():
    args = parse_args()
    image_path = Path(args.image)

    if not image_path.exists():
        raise RuntimeError(f"Image not found: {image_path}")

    image = cv2.imread(str(image_path))
    if image is None:
        raise RuntimeError("Unable to read image")

    labels, embeddings = load_embeddings()
    model = build_embedding_model()
    detector = get_face_detector()
    face = detect_largest_face(image, detector)

    result = {
        "success": True,
        "matched": False,
        "message": "No face detected",
        "liveness": None,
    }

    if face is None:
        print(json.dumps(result))
        return

    # Perform liveness check if requested
    liveness_result = None
    if args.check_liveness:
        liveness_result = check_static_image_liveness(image)
        result["liveness"] = {
            "is_live": liveness_result["is_live"],
            "confidence": round(liveness_result["confidence"], 4),
            "checks": liveness_result["checks"]
        }
        
        # If liveness check fails, reject the image
        if not liveness_result["is_live"]:
            result["message"] = "Spoof detected - Image appears to be a photo or screen"
            result["matched"] = False
            print(json.dumps(result))
            return

    face_tensor = extract_face_tensor(image, face)
    embedding = compute_embedding(model, face_tensor)
    label, score, second_score = find_best_match(embedding, labels, embeddings)
    margin = score - second_score

    if not label or score < CONFIDENCE_THRESHOLD or margin < CONFIDENCE_MARGIN:
        result["message"] = "Unknown face or confidence is too low"
        result["confidence"] = round(score, 4)
        result["matchMargin"] = round(margin, 4)
        result["threshold"] = CONFIDENCE_THRESHOLD
        result["matched"] = False
        print(json.dumps(result))
        return

    result["success"] = True
    result["matched"] = True
    result["label"] = label
    result["confidence"] = round(score, 4)
    result["matchMargin"] = round(margin, 4)
    result["box"] = {
        "x": int(face[0]),
        "y": int(face[1]),
        "w": int(face[2]),
        "h": int(face[3]),
    }
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()
