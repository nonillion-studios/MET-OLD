"""
Alternative entry point for the Manga-AI-detector model: a Gradio demo UI instead
of the raw Flask API. Useful for quickly trying the model or sharing a public demo
link (e.g. from Google Colab) without writing any client code.

Requires `best.pt` to be present in this folder (see README.md).
"""
import cv2
import gradio as gr
import numpy as np
from ultralytics import YOLO

MODEL_PATH = "best.pt"
model = YOLO(MODEL_PATH)


def detect(image: np.ndarray, confidence: float):
    if image is None:
        return None, {}

    # Gradio provides RGB images; ultralytics/cv2 expect BGR for drawing.
    img_bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)

    results = model.predict(img_bgr, conf=confidence, verbose=False)
    result = results[0]
    names = result.names

    detections = []
    annotated = img_bgr.copy()
    boxes = result.boxes
    if boxes is not None:
        for i in range(len(boxes)):
            cls_id = int(boxes.cls[i].item())
            conf = float(boxes.conf[i].item())
            x1, y1, x2, y2 = [float(v) for v in boxes.xyxy[i].tolist()]
            class_name = names.get(cls_id, str(cls_id)) if isinstance(names, dict) else names[cls_id]

            detections.append({
                "class_name": class_name,
                "confidence": conf,
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
            })

            cv2.rectangle(annotated, (int(x1), int(y1)), (int(x2), int(y2)), (0, 0, 255), 2)
            cv2.putText(annotated, f"{class_name} {conf:.2f}", (int(x1), max(0, int(y1) - 5)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1, cv2.LINE_AA)

    annotated_rgb = cv2.cvtColor(annotated, cv2.COLOR_BGR2RGB)
    return annotated_rgb, {"detections": detections, "count": len(detections)}


demo = gr.Interface(
    fn=detect,
    inputs=[
        gr.Image(type="numpy", label="Manga Page"),
        gr.Slider(minimum=0.05, maximum=0.95, value=0.25, step=0.05, label="Confidence"),
    ],
    outputs=[
        gr.Image(type="numpy", label="Annotated Page"),
        gr.JSON(label="Detections"),
    ],
    title="Manga-AI-detector",
    description="YOLOv11 detector for panel / bubble / text / sfx regions in manga pages.",
)

if __name__ == "__main__":
    demo.launch(share=True)
