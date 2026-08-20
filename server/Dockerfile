FROM python:3.11-slim

WORKDIR /app

# System deps needed by opencv-python at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# NOTE: best.pt (the trained model weights) is not included in this image.
# Mount it in, or COPY it in a downstream build, before running.

EXPOSE 5000

CMD ["python", "api_server.py"]
