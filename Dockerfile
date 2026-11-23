# Runs the Spark pipeline (not the website). Output lands in public/data and api/_data.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends default-jre-headless && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY pipeline ./pipeline
COPY tests ./tests
CMD ["sh", "-c", "python pipeline/generate_data.py && python pipeline/run_pipeline.py"]
