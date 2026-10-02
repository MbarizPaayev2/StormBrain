# Jenkins agent prerequisites (controller + agent checklist).
#
# CONTROLLER (Jenkins LTS):
#   - Plugins: Pipeline, Git, Credentials Binding, JUnit, Warnings NG.
#   - Optional: Cobertura, Docker, SSH Agent (only if you add deploy later).
#   - New Item -> Pipeline -> "Pipeline script from SCM" -> point to this repo,
#     Script Path: jenkins/Jenkinsfile
#
# AGENT (label it e.g. `linux-python`):
#   - Linux recommended (install.sh supports Linux/macOS/Termux only).
#   - python3 + pip + venv, git, node (>=18 for `node --check`).
#   - No secrets on disk: SECRET_KEY / STORM_ADMIN_* come from Jenkins credentials.
#
# CREDENTIALS (Jenkins -> Manage -> Credentials):
#   - github-pat (username + PAT) if the repo is private.
#   - SECRET_KEY, STORM_ADMIN_USER, STORM_ADMIN_PASSWORD as Secret text
#     (only needed for deploy jobs, never for CI lint/test).
#
# WEBHOOK (optional, else poll):
#   - GitHub repo -> Settings -> Webhooks -> <jenkins>/github-webhook/
#   - or add `triggers { pollSCM('H/5 * * * *') }` to the Jenkinsfile.
#
# NEVER in CI:
#   - `python st.py` (archives sessions, prompts for ngrok token, blocks forever).
#   - real `.secrets/` or `storm-web/sessions|images|sounds|visitors|log` writes
#     (tests redirect them to tmp via fixtures).
