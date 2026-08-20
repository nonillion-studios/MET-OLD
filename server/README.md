# Manga-AI-detector server

Scaffold for running the YOLOv11 detector (from
[Manga-AI-detector](https://github.com/nonillion-studios/Manga-AI-detector)) as an
HTTP API that the manga translation app's Ultra Mode talks to
(`src/lib/detector.ts`).

This model detects 4 classes: `panel`, `bubble`, `text`, `sfx`.

You must supply your own trained weights — `best.pt` — copied from the
Manga-AI-detector repo (or your own training run). No weights are included here.

## Ways to run it

### 1. Local Python

```bash
pip install -r requirements.txt
# copy best.pt from your Manga-AI-detector repo into this folder
python api_server.py
```

Serves on `http://localhost:5000`. Point the app's Settings → Ultra Mode →
Detector Endpoint at that URL.

### 2. Docker

```bash
docker build -t manga-detector .
docker run -p 5000:5000 -v $(pwd)/best.pt:/app/best.pt manga-detector
```

(Mounting `best.pt` in at run time keeps the image itself weight-free; you can
also `COPY best.pt .` into a custom image if you prefer it baked in.)

### 3. Gradio (quick demo UI)

```bash
python gradio_app.py
```

Launches a Gradio `Interface` (image in → annotated image + JSON detections
out) with `share=True`, so it also prints a temporary public URL — handy for
quickly trying the model without writing any client code.

**Deploying to a Hugging Face ZeroGPU Space**: ZeroGPU Spaces require at least
one GPU-touching function to be decorated with `@spaces.GPU` (from the `spaces`
package), imported *before* torch/CUDA initializes — otherwise the Space fails
to start with `No @spaces.GPU function detected during startup`. `gradio_app.py`
already handles this: it imports `spaces` and wraps `detect()` in `@spaces.GPU`
when the package is available, and falls back to a no-op decorator everywhere
else (local runs, Docker, plain Colab) so the same file works in both contexts.
Add `spaces` to your Space's `requirements.txt` (it's preinstalled on HF Spaces
runtime and doesn't need to be pinned) - it isn't in this folder's
`requirements.txt` since it's only meaningful on Hugging Face's own infrastructure.

### 4. Free cloud (Google Colab)

Run in a Colab notebook with a free GPU:

```python
!pip install -r requirements.txt
# upload best.pt via the Colab file browser or drive mount
!python api_server.py &   # run in background
!pip install pyngrok
```

Then expose port 5000 publicly, either with `pyngrok`:

```python
from pyngrok import ngrok
public_url = ngrok.connect(5000)
print(public_url)
```

or with `cloudflared`:

```bash
cloudflared tunnel --url http://localhost:5000
```

Paste the resulting public URL into the app's **Settings → Ultra Mode →
Detector Endpoint** field.

## API contract

This is the exact shape `src/lib/detector.ts` expects back from the server —
keep both sides in sync if you change one.

### `POST /api/detect`

Multipart form fields:
- `image` — file
- `confidence` — float, default `0.25`

Response:

```json
{
  "success": true,
  "detections": [
    {
      "class_name": "bubble",
      "confidence": 0.93,
      "bbox": { "x1": 120.0, "y1": 80.0, "x2": 340.0, "y2": 260.0 },
      "polygon": [{ "x": 121.0, "y": 82.0 }, { "x": 130.0, "y": 78.0 }]
    }
  ],
  "count": 1,
  "timestamp": 1732000000.123
}
```

`polygon` (or `mask`, same shape) is **optional** and only present when the
loaded weights are a YOLOv11 **segmentation** model (`*-seg`), not a plain
detection model. The client (`detector.ts`) checks for it and falls back to
flood-fill bubble tracing seeded from the bbox center when it's absent.

### `POST /api/detect/with-visualization`

Same request as `/api/detect`. Response adds:

```json
{ "annotated_image": "<base64 JPEG>" }
```

### `POST /api/batch-detect`

Multipart form field `images` (repeated file field), plus `confidence`.

```json
{
  "success": true,
  "results": [
    { "filename": "page1.jpg", "success": true, "detections": [...], "count": 2 }
  ],
  "timestamp": 1732000000.123
}
```

### `GET /api/model-info`

```json
{ "success": true, "model_path": "best.pt", "classes": ["panel", "bubble", "text", "sfx"], "task": "detect" }
```

### `GET /health`

```json
{ "status": "ok" }
```
