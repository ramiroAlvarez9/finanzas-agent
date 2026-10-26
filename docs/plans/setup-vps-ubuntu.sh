#!/usr/bin/env bash
set -Eeuo pipefail

# Bootstrap/deploy script for an Ubuntu VPS running this agent with Docker.
# Run from the repository root as a user with sudo access:
#   bash docs/plans/setup-vps-ubuntu.sh
#
# The script does not create or print secrets. Put real values in .env before
# starting the stack. It is safe to run again when the VPS needs an update.

APP_DIR="${APP_DIR:-/opt/calorito}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"

log() {
  printf '\n[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_root_capability() {
  if [[ "$(id -u)" -eq 0 ]]; then
    SUDO=""
  elif command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    die "Ejecutá el script como root o instalá sudo."
  fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker y Docker Compose ya están instalados."
    return
  fi

  log "Instalando Docker Engine y Docker Compose Plugin."
  $SUDO apt-get update
  $SUDO apt-get install -y ca-certificates curl
  $SUDO install -m 0755 -d /etc/apt/keyrings
  $SUDO curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  $SUDO chmod a+r /etc/apt/keyrings/docker.asc

  . /etc/os-release
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
    "$(dpkg --print-architecture)" "$VERSION_CODENAME" \
    | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null

  $SUDO apt-get update
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO systemctl enable --now docker

  if [[ -n "${SUDO}" ]]; then
    $SUDO usermod -aG docker "${SUDO_USER:-$USER}" || true
  fi
}

prepare_app() {
  if [[ ! -d "$APP_DIR/.git" ]]; then
    [[ -n "$REPO_URL" ]] || die "Definí REPO_URL para clonar el repositorio, por ejemplo REPO_URL=https://github.com/org/repo.git."
    log "Clonando el repositorio en $APP_DIR."
    $SUDO mkdir -p "$(dirname "$APP_DIR")"
    $SUDO git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  else
    log "Actualizando el repositorio existente."
    $SUDO git -C "$APP_DIR" fetch origin "$BRANCH"
    $SUDO git -C "$APP_DIR" checkout "$BRANCH"
    $SUDO git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
  fi

  $SUDO mkdir -p "$APP_DIR/data" "$APP_DIR/workflow-data"
  $SUDO chown -R "${SUDO_USER:-$USER}:${SUDO_USER:-$USER}" "$APP_DIR" || true
}

ensure_env() {
  local env_file="$APP_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    $SUDO cp "$APP_DIR/.env.example" "$env_file"
    $SUDO chmod 600 "$env_file"
    die "Se creó $env_file. Completá los secretos y ejecutá el script nuevamente."
  fi

  local missing=()
  for key in OPENROUTER_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_BOT_USERNAME TELEGRAM_WEBHOOK_SECRET_TOKEN DOMAIN; do
    if ! $SUDO grep -Eq "^${key}=[^[:space:]]+" "$env_file"; then
      missing+=("$key")
    fi
  done
  ((${#missing[@]} == 0)) || die "Faltan variables en $env_file: ${missing[*]}"
  $SUDO chmod 600 "$env_file"
}

start_stack() {
  log "Construyendo y levantando los contenedores."
  $SUDO docker compose -f "$APP_DIR/docker-compose.yml" up -d --build
  $SUDO docker compose -f "$APP_DIR/docker-compose.yml" ps
}

configure_webhook() {
  local env_file="$APP_DIR/.env"
  local token secret domain
  token="$($SUDO awk -F= '$1 == "TELEGRAM_BOT_TOKEN" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  secret="$($SUDO awk -F= '$1 == "TELEGRAM_WEBHOOK_SECRET_TOKEN" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  domain="$($SUDO awk -F= '$1 == "DOMAIN" { print substr($0, index($0, "=") + 1) }' "$env_file")"

  log "Configurando el webhook de Telegram."
  curl --fail-with-body --silent --show-error \
    -X POST "https://api.telegram.org/bot${token}/setWebhook" \
    -H 'Content-Type: application/json' \
    -d "{\"url\":\"https://${domain}/eve/v1/telegram\",\"secret_token\":\"${secret}\",\"allowed_updates\":[\"message\",\"callback_query\"]}"
  printf '\n'
}

print_next_steps() {
  local domain backup_date
  domain="$($SUDO awk -F= '$1 == "DOMAIN" { print substr($0, index($0, "=") + 1) }' "$APP_DIR/.env")"
  backup_date="$(date -u +%Y%m%dT%H%M%SZ)"
  cat <<EOF

Deploy terminado.

Aplicación: $APP_DIR
URL pública: https://$domain

Comandos útiles:
  cd $APP_DIR
  sudo docker compose ps
  sudo docker compose logs -f agent
  sudo docker compose pull && sudo docker compose up -d --build
  sudo docker compose down

Backup SQLite y estado del agente:
  sudo mkdir -p /var/backups
  sudo tar -C $APP_DIR -czf /var/backups/calorito-$backup_date.tar.gz data workflow-data

Importante:
  - Abrí únicamente los puertos 22, 80 y 443 en el firewall/proveedor.
  - Conservá una copia segura de $APP_DIR/.env.
  - Caddy administra los certificados HTTPS automáticamente para DOMAIN.
EOF
}

main() {
  [[ -f /etc/os-release ]] || die "Este script requiere Ubuntu/Debian con /etc/os-release."
  . /etc/os-release
  [[ "$ID" == "ubuntu" ]] || die "Este script está preparado para Ubuntu; detectado: $ID."

  require_root_capability
  install_docker
  prepare_app
  ensure_env
  start_stack
  configure_webhook
  print_next_steps
}

main "$@"
