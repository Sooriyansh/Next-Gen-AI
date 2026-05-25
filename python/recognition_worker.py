import json
import os
import sys
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import cv2
import numpy as np

from config import CONFIDENCE_MARGIN, CONFIDENCE_THRESHOLD, EMBEDDINGS_PATH
from utils import (
    build_embedding_model,
    compute_embedding,
    cosine_similarity,
    detect_largest_face,
    extract_face_tensor,
    get_face_detector,
    validate_face_quality,
)


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


def recognize_image(model, detector, labels, embeddings, image_path):
    image = cv2.imread(str(image_path))
    if image is None:
        raise RuntimeError("Unable to read image")

    face = detect_largest_face(image, detector)
    if face is None:
        return {"success": True, "matched": False, "message": "No face detected. Keep your face in front of the camera."}

    quality = validate_face_quality(image, face)
    if not quality["is_valid"]:
        error_msg = " | ".join(quality["error_messages"]) if quality["error_messages"] else "Face quality is poor."
        return {
            "success": True,
            "matched": False,
            "message": error_msg,
            "confidence": 0,
            "quality_issues": quality["error_messages"]
        }

    face_tensor = extract_face_tensor(image, face)
    embedding = compute_embedding(model, face_tensor)
    label, score, second_score = find_best_match(embedding, labels, embeddings)
    margin = score - second_score

    if not label or score < CONFIDENCE_THRESHOLD or margin < CONFIDENCE_MARGIN:
        if score >= CONFIDENCE_THRESHOLD and margin < CONFIDENCE_MARGIN:
            message = "Face match is close, but another saved face looks too similar. Try scanning again with your face centered."
        else:
            message = "Face was not recognized with enough confidence. Please improve lighting, center your face, and scan again."

        return {
            "success": True,
            "matched": False,
            "message": message,
            "confidence": round(score, 4),
            "matchMargin": round(margin, 4),
            "threshold": CONFIDENCE_THRESHOLD,
            "marginThreshold": CONFIDENCE_MARGIN,
        }

    return {
        "success": True,
        "matched": True,
        "label": label,
        "confidence": round(score, 4),
        "matchMargin": round(margin, 4),
        "box": {
            "x": int(face[0]),
            "y": int(face[1]),
            "w": int(face[2]),
            "h": int(face[3]),
        },
    }


def emit(payload):
    print(json.dumps(payload), flush=True)


def main():
    try:
        model = build_embedding_model()
        detector = get_face_detector()
        labels, embeddings = load_embeddings()
        emit({"type": "ready"})
    except Exception as error:
        emit({"type": "fatal", "message": str(error)})
        return

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            request_id = request["id"]
            image_path = Path(request["imagePath"])
            result = recognize_image(model, detector, labels, embeddings, image_path)
            emit({"type": "result", "id": request_id, "result": result})
        except Exception as error:
            emit(
                {
                    "type": "result",
                    "id": request.get("id") if "request" in locals() else None,
                    "result": {"success": False, "message": str(error)},
                }
            )


if __name__ == "__main__":
    main()
