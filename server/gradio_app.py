"""
Alternative entry point for the Manga-AI-detector model: a Gradio demo UI instead
of the raw Flask API. Useful for quickly trying the model or sharing a public demo
link (e.g. from Google Colab) without writing any client code.

Requires `best.pt` to be present in this folder (see README.md).

Hugging Face ZeroGPU Spaces note: a ZeroGPU Space requires at least one function
that actually touches the GPU to be wrapped in `@spaces.GPU` (from the `spaces`
package), and `import spaces` must happen before any CUDA/torch initialization -
otherwise the Space fails to start with "No @spaces.GPU function detected during
startup". This only applies when running on an actual ZeroGPU Space; the try/except
below makes the decorator a no-op everywhere else (local runs, Docker, plain Colab).
"""
import cv2
import gradio as gr
import numpy as np

try:
    import spaces
    gpu_decorator = spaces.GPU
except ImportError:
    def gpu_decorator(fn=None, **kwargs):
        return fn if fn is not None else (lambda f: f)

from ultralytics import YOLO

MODEL_PATH = "best.pt"
model = YOLO(MODEL_PATH)


@gpu_decorator
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
    # `result.masks` is only populated when the loaded weights are a YOLOv11-seg
    # (segmentation) model - same as api_server.py's run_detection(). Detection-only
    # weights leave this as None and only bbox is returned in that case.
    masks = getattr(result, "masks", None)
    if boxes is not None:
        for i in range(len(boxes)):
            cls_id = int(boxes.cls[i].item())
            conf = float(boxes.conf[i].item())
            x1, y1, x2, y2 = [float(v) for v in boxes.xyxy[i].tolist()]
            class_name = names.get(cls_id, str(cls_id)) if isinstance(names, dict) else names[cls_id]

            detection = {
                "class_name": class_name,
                "confidence": conf,
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
            }

            if masks is not None:
                try:
                    # xy is a list of (N, 2) arrays of polygon points in original image coords
                    poly = masks.xy[i]
                    detection["polygon"] = [{"x": float(p[0]), "y": float(p[1])} for p in poly]
                    cv2.polylines(annotated, [poly.astype(np.int32)], True, (0, 0, 255), 2)
                except (IndexError, AttributeError):
                    pass

            detections.append(detection)

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
# Gradio names the callable API endpoint after the wrapped function (i.e. "/detect",
# since fn=detect above) - src/lib/detector.ts's detectPageViaGradio() calls it by
# that name. If you rename detect() to something else, update detector.ts to match.

if __name__ == "__main__":
    demo.launch(share=True)
