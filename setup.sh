#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NEXGI Setup Script
# Installs all dependencies and creates .env files from examples
# Usage: bash setup.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m"  # No Color

print_step() { echo -e "\n${BLUE}${BOLD}▶ $1${NC}"; }
print_ok()   { echo -e "  ${GREEN}✓ $1${NC}"; }
print_warn() { echo -e "  ${YELLOW}⚠ $1${NC}"; }
print_err()  { echo -e "  ${RED}✗ $1${NC}"; }

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  NEXGI — Environmental Intelligence Platform  ·  Setup${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# ─── Check prerequisites ──────────────────────────────────────────────────────
print_step "Checking prerequisites"

if command -v python3 &>/dev/null; then
  PYTHON_VER=$(python3 --version 2>&1)
  print_ok "Python: $PYTHON_VER"
else
  print_err "Python 3.11+ is required. Install from https://python.org"
  exit 1
fi

if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  print_ok "Node.js: $NODE_VER"
else
  print_err "Node.js 18+ is required. Install from https://nodejs.org"
  exit 1
fi

if command -v yarn &>/dev/null; then
  YARN_VER=$(yarn --version)
  print_ok "Yarn: $YARN_VER"
elif command -v npm &>/dev/null; then
  print_warn "Yarn not found. Installing via npm..."
  npm install -g yarn
  print_ok "Yarn installed"
else
  print_err "npm / yarn required"
  exit 1
fi

# ─── Backend setup ────────────────────────────────────────────────────────────
print_step "Setting up Backend (FastAPI)"

cd backend

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  print_ok "Virtual environment created"
else
  print_ok "Virtual environment already exists"
fi

source .venv/bin/activate || { print_err "Failed to activate virtualenv"; exit 1; }

pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
print_ok "Python dependencies installed"

if [ ! -f ".env" ]; then
  cp .env.example .env
  print_warn ".env created from .env.example — edit it with your values before running!"
else
  print_ok ".env already exists"
fi

deactivate
cd ..

# ─── Frontend setup ───────────────────────────────────────────────────────────
print_step "Setting up Frontend (Vite + React)"

cd frontend

yarn install --silent
print_ok "Node dependencies installed"

if [ ! -f ".env" ]; then
  cp .env.example .env
  print_ok ".env created from .env.example"
else
  print_ok ".env already exists"
fi

cd ..

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  Setup complete!${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "  1. Edit ${YELLOW}backend/.env${NC} with your MongoDB URL and JWT secret"
echo -e "  2. Run the backend:   ${BLUE}cd backend && source .venv/bin/activate && uvicorn server:app --reload${NC}"
echo -e "  3. Run the frontend:  ${BLUE}cd frontend && yarn dev${NC}"
echo -e "  4. Open:              ${BLUE}http://localhost:3000${NC}"
echo -e "\n  Demo login: ${YELLOW}test@gmail.com${NC} / ${YELLOW}12345678${NC}\n"
