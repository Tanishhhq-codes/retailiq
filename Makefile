.PHONY: data pipeline test web build all
data:      ; python3 pipeline/generate_data.py
pipeline:  ; python3 pipeline/run_pipeline.py
test:      ; python3 -m pytest -q tests
web:       ; npm install && npm run dev
build:     ; npm install && npm run build
all: data pipeline test build
