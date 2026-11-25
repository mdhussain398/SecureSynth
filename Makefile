PY := $(CURDIR)/.venv/bin/python
BE := cd backend &&

.PHONY: setup env train eval seed test dev-backend dev-frontend types reset

setup: env ## one-time: venv + deps + model + demo data (run on a good network)
	test -d .venv || python3.12 -m venv .venv
	.venv/bin/pip install -q -r backend/requirements.txt
	cd frontend && npm ci
	$(MAKE) train seed

env: ## create backend/.env with fresh local secrets (never committed)
	@test -f backend/.env || $(PY) -c "import secrets; from cryptography.fernet import Fernet; \
	open('backend/.env','w').write('SS_SECRET_KEY='+secrets.token_urlsafe(32)+'\nSS_FERNET_KEY='+Fernet.generate_key().decode()+'\nSS_DEMO_MODE=true\nSS_GHOST_BANKING_ENABLED=false\n')"
	@echo "backend/.env ready"

train: ## deterministic synthetic data + Isolation Forest + validation tuning
	$(BE) $(PY) -m ml.train

eval: ## held-out test evaluation → backend/artifacts/eval_report.json
	$(BE) $(PY) -m ml.evaluate

seed: env ## demo DB + pristine snapshot + local demo credentials
	$(BE) $(PY) -m app.demo_seed

test:
	$(BE) $(PY) -m pytest

dev-backend:
	$(BE) $(PY) -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000

dev-frontend:
	cd frontend && npm run dev

types:
	cd frontend && npm run types
