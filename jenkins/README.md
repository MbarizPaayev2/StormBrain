# jenkins/ — CI/CD for StormBrain (Flask, no Docker required)

## Layout

```
jenkins/
  Jenkinsfile          # declarative pipeline (checkout -> venv -> lint -> test -> security -> package)
  requirements-ci.txt  # CI-only tools (pytest, ruff, bandit, pip-audit)
  tests/
    test_smoke.py      # Flask test-client checks + IP-extraction regression
  scripts/
    local-ci.sh        # run the same gates locally: sh jenkins/scripts/local-ci.sh
  AGENTS.md            # controller/agent/credentials checklist
  README.md            # this file
```

## What CI does

1. `Setup Python` — venv + `requirements.txt` + `requirements-ci.txt`
2. `Lint / Syntax` (parallel) — `py_compile + ruff`, `node --check x3`, `bash -n`
3. `Unit tests` — `pytest jenkins/tests --junitxml=junit.xml`
4. `Security scan` — `bandit + pip-audit` (non-blocking, `|| true`)
5. `Package artifact` (main/master only) — `stormbrain-<sha>.tar.gz`

## What CI never does

- Never runs `python st.py` (interactive ngrok launcher, blocks forever).
- Never writes real `.secrets/` or harvested data (tests use tmp dirs).
- Secrets (`SECRET_KEY`, `STORM_ADMIN_*`, `NGROK_AUTHTOKEN`) come from
  Jenkins credentials, only for deploy jobs.

## Jenkins job setup

1. New Item -> Pipeline -> Pipeline script from SCM -> this repo.
2. Script Path: `jenkins/Jenkinsfile`, Branch: `main`.
3. Agent label: `linux-python` (python3 + node).
4. Build on push via webhook or `pollSCM`.

## Local verification

```sh
sh jenkins/scripts/local-ci.sh
```
