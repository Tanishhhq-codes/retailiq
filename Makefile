.PHONY: data pipeline test web build backend all
data:      ; python3 pipeline/generate_data.py
pipeline:  ; python3 pipeline/run_pipeline.py
test:      ; python3 -m pytest -q tests
backend:   ; uvicorn backend.app:app --port 8000
web:       ; npm install && npm run dev
build:     ; npm install && npm run build
all: data pipeline test build
