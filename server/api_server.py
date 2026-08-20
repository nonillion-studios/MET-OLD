"""
Flask API server for the Manga-AI-detector YOLOv11 model
(github.com/nonillion-studios/Manga-AI-detector).

Detects 4 classes: panel, bubble, text, sfx.

IMPORTANT: This scaffold does NOT include the trained weights. Copy `best.pt`
from your Manga-AI-detector repo/training run into this `server/` folder
before running this file.

Endpoints (see README.md for the full request/response contract used by the
manga translation app's `src/lib/detector.ts` client):
  POST /api/detect                       - single image detection
  POST /api/detect/with-visualization     - single image detection + annotated image
  POST /api/batch-detect                  - multiple images
  GET  /api/model-info                    - model metadata
  GET  /health                            - liveness check
"""
import base64
import io
import time

import cv2
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from ultralytics import YOLO

app = Flask(__name__)
CORS(app)

MODEL_PATH = "best.pt"
model = None


def load_model():
    global model
    if model is None:
        model = YOLO(MODEL_PATH)
    return model


def read_image_from_request(file_storage) -> np.ndarray:
    file_bytes = np.frombuffer(file_storage.read(), np.uint8)
    img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode uploaded image")
    return img


def run_detection(img: np.ndarray, confidence: float):
    """Runs the model on a single image and returns a list of detection dicts
    matching the contract expected by the client (class_name, confidence, bbox,
    and an optional polygon when the loaded model is a segmentation variant)."""
    m = load_model()
    results = m.predict(img, conf=confidence, verbose=False)
    result = results[0]

    detections = []
    names = result.names

    boxes = result.boxes
    # `result.masks` is only populated when the loaded weights are a YOLOv11-seg
    # (segmentation) model. Detection-only weights (best.pt trained without -seg)
    # will leave this as None, in which case only bbox is returned and the client
    # is expected to fall back to flood-fill for precise bubble geometry.
    masks = getattr(result, "masks", None)

    if boxes is None:
        return detections

    for i in range(len(boxes)):
        cls_id = int(boxes.cls[i].item())
        conf = float(boxes.conf[i].item())
        x1, y1, x2, y2 = [float(v) for v in boxes.xyxy[i].tolist()]

        detection = {
            "class_name": names.get(cls_id, str(cls_id)) if isinstance(names, dict) else names[cls_id],
            "confidence": conf,
            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
        }

        if masks is not None:
            try:
                # xy is a list of (N, 2) arrays of polygon points in original image coords
                poly = masks.xy[i]
                detection["polygon"] = [{"x": float(p[0]), "y": float(p[1])} for p in poly]
            except (IndexError, AttributeError):
                pass

        detections.append(detection)

    return detections


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/api/model-info", methods=["GET"])
def model_info():
    m = load_model()
    names = m.names
    class_names = list(names.values()) if isinstance(names, dict) else list(names)
    return jsonify({
        "success": True,
        "model_path": MODEL_PATH,
        "classes": class_names,
        "task": getattr(m, "task", "unknown"),
    })


@app.route("/api/detect", methods=["POST"])
def detect():
    if "image" not in request.files:
        return jsonify({"success": False, "error": "No 'image' file provided"}), 400

    confidence = float(request.form.get("confidence", 0.25))

    try:
        img = read_image_from_request(request.files["image"])
        detections = run_detection(img, confidence)
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": str(e)}), 500

    return jsonify({
        "success": True,
        "detections": detections,
        "count": len(detections),
        "timestamp": time.time(),
    })


@app.route("/api/detect/with-visualization", methods=["POST"])
def detect_with_visualization():
    if "image" not in request.files:
        return jsonify({"success": False, "error": "No 'image' file provided"}), 400

    confidence = float(request.form.get("confidence", 0.25))

    try:
        img = read_image_from_request(request.files["image"])
        detections = run_detection(img, confidence)

        annotated = img.copy()
        for det in detections:
            b = det["bbox"]
            p1 = (int(b["x1"]), int(b["y1"]))
            p2 = (int(b["x2"]), int(b["y2"]))
            cv2.rectangle(annotated, p1, p2, (0, 0, 255), 2)
            label = f"{det['class_name']} {det['confidence']:.2f}"
            cv2.putText(annotated, label, (p1[0], max(0, p1[1] - 5)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1, cv2.LINE_AA)

        ok, buf = cv2.imencode(".jpg", annotated)
        if not ok:
            raise ValueError("Failed to encode annotated image")
        annotated_b64 = base64.b64encode(buf.tobytes()).decode("utf-8")
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": str(e)}), 500

    return jsonify({
        "success": True,
        "detections": detections,
        "count": len(detections),
        "annotated_image": annotated_b64,
        "timestamp": time.time(),
    })


@app.route("/api/batch-detect", methods=["POST"])
def batch_detect():
    files = request.files.getlist("images")
    if not files:
        return jsonify({"success": False, "error": "No 'images' files provided"}), 400

    confidence = float(request.form.get("confidence", 0.25))

    results = []
    for f in files:
        try:
            img = read_image_from_request(f)
            detections = run_detection(img, confidence)
            results.append({
                "filename": f.filename,
                "success": True,
                "detections": detections,
                "count": len(detections),
            })
        except Exception as e:  # noqa: BLE001
            results.append({"filename": f.filename, "success": False, "error": str(e)})

    return jsonify({"success": True, "results": results, "timestamp": time.time()})


if __name__ == "__main__":
    load_model()
    app.run(host="0.0.0.0", port=5000)
