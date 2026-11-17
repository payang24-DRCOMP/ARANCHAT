#!/usr/bin/env bash
# ถอดเสียงภาษาไทย (OpenThai2.0-ASR-Streaming · iapp · OpenMDW-1.1) สำหรับ AranChat — ใช้ venv/โมเดลที่ติดตั้งไว้ที่ /opt/ai/asr-openthai
# เปิดเฉพาะ 127.0.0.1:18081 (notify เรียก) · GPU 1 (GPU 0 = ollama) · pm2: aranchat-asr
# API: POST /v1/transcribe (multipart file, mode=standard|conversation|meeting) · GET /v1/health
set -euo pipefail
cd /opt/ai/asr-openthai/model/serve
export CUDA_VISIBLE_DEVICES=${ASR_GPU:-1} CHINDA_DEVICE=cuda CHINDA_HOST=127.0.0.1 CHINDA_PORT=${ASR_PORT:-18081}
exec /opt/ai/asr-openthai/venv/bin/python app.py
