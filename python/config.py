from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATASET_DIR = DATA_DIR / "dataset"
MODELS_DIR = DATA_DIR / "models"
EMBEDDINGS_PATH = MODELS_DIR / "face_embeddings.npz"

IMAGE_SIZE = (160, 160)
CONFIDENCE_THRESHOLD = 0.78
CONFIDENCE_MARGIN = 0.02
MARK_COOLDOWN_SECONDS = 20

for directory in (DATA_DIR, DATASET_DIR, MODELS_DIR):
    directory.mkdir(parents=True, exist_ok=True)
