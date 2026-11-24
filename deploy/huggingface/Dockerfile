# Hugging Face Space (free CPU: 16 GB RAM). Builds the backend straight from the GitHub repo,
# so this Space repository only needs this Dockerfile and the README.md next to it.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends default-jre-headless git && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH \
    RETAILIQ_JOBS_DIR=/tmp/jobs RETAILIQ_JOB_TTL_HOURS=6 RETAILIQ_CORS_ORIGINS=*
WORKDIR /home/user/app
ARG REPO=https://github.com/Tanishhhq-codes/retailiq.git
RUN git clone --depth 1 $REPO . && pip install --no-cache-dir -r backend/requirements.txt
EXPOSE 7860
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "7860"]
