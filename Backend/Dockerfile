FROM python:3.11-slim
WORKDIR /app

# Install minimal build/runtime deps (helps with bcrypt, scikit-learn, etc.)
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
		build-essential \
		gcc \
		libffi-dev \
		libssl-dev \
		make \
		libgomp1 \
	&& rm -rf /var/lib/apt/lists/*


# Copy requirements from the build context. When this Dockerfile is used with
# the `Backend/` folder as the build context (e.g., Render service root),
# `requirements.txt` will be at `./requirements.txt`.
COPY requirements.txt /app/requirements.txt

# Ensure pip/setuptools/wheel are recent so manylinux wheels are used when possible
RUN pip install --upgrade pip setuptools wheel \
	&& pip install --no-cache-dir -r /app/requirements.txt

# Copy the backend source from the build context into the image. When the
# Docker build context is the `Backend/` folder, use `.` to copy the files.
COPY . /app
ENV PYTHONUNBUFFERED=1
# Default port; Render will set $PORT at runtime. Keep a sane default for local testing.
ENV PORT=8000
# Default concurrency tunable via Render env vars
ENV WEB_CONCURRENCY=1
EXPOSE 8000

# Bind to the platform-provided $PORT so Render can detect the open port
CMD ["sh", "-c", "exec gunicorn -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:${PORT} --workers ${WEB_CONCURRENCY}"]
