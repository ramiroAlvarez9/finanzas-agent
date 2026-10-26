# Deploy en Oracle Cloud (Ubuntu)

Guía para correr `finanzas-agent` en una instancia de Oracle Cloud Infrastructure (OCI) con Ubuntu 22.04/24.04.

La app necesita:

- Un dominio (o un `sslip.io`/DuckDNS) apuntando a la IP pública.
- Puertos **80** y **443** abiertos en **dos firewalls**: el de OCI y el de Ubuntu.
- Un volumen persistente para `data/finanzas.db`.
- Un bot de Telegram nuevo y su webhook con `callback_query`.

---

## 1. Crear la instancia

En OCI:

1. Compute → Instances → Create Instance.
2. Imagen: **Ubuntu 22.04** o **24.04**.
3. Shape: Ampere A1 (ARM) o AMD. Para compilar la imagen de Docker, mejor **2 GB de RAM** o más. Si usás la instancia AMD micro gratuita de 1 GB, agregá swap (ver sección 10).
4. Asigná una **reserved public IP** para que la IP no cambie.
5. Guardá la clave SSH (`~/.ssh/oracle_key` o similar).

Conectate:

```bash
ssh -i ~/.ssh/oracle_key ubuntu@<PUBLIC_IP>
```

Si ya usás Tailscale para entrar, instalalo y conectate por MagicDNS o por la IP `100.x`:

```bash
ssh ubuntu@<tailscale-hostname>
```

En ese caso podés cerrar el puerto 22 público. Está explicado en la sección 5.

---

## 2. Abrir puertos en OCI

OCI tiene su propio firewall de red. No alcanza con abrir los puertos dentro de Ubuntu.

Ruta:

```text
Networking → Virtual Cloud Networks → <tu VCN> → Security Lists → Default Security List
```

Agregá estas **Ingress Rules**:

| Source | IP Protocol | Destination Port Range | Para |
|---|---|---|---|
| `0.0.0.0/0` | TCP | `80` | Caddy / ACME HTTP |
| `0.0.0.0/0` | TCP | `443` | HTTPS |
| Tu IP /32 | TCP | `22` | SSH (mejor restringido) |

Si usás **Network Security Groups (NSG)** en vez de Security List, agregá las mismas reglas al NSG asociado a la instancia.

> Si entrás por **Tailscale SSH**, podés omitir la regla pública de 22 y cerrar ese puerto. Tailscale no necesita que 22 esté abierto a Internet. Probá la conexión por Tailscale antes de cerrarlo.

Si tu instancia tiene IPv6, agregá también `::/0` para 80 y 443.

> No abras el puerto `3000` a Internet. Caddy habla con el contenedor por la red interna de Docker.

---

## 3. Abrir puertos dentro de Ubuntu

Las imágenes Ubuntu de Oracle suelen traer `iptables` con una regla final `REJECT`, y a veces `ufw` desactivado. Revisá ambos.

### Si usás ufw

```bash
sudo ufw status
```

Si está activo:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

### Si usás iptables (lo más común en Oracle Ubuntu)

Mirá las reglas:

```bash
sudo iptables -L INPUT --line-numbers -n
```

Buscá la línea del `REJECT` final. Insertá las reglas **antes** de ese `REJECT`. En las imágenes estándar de Oracle suele ser la línea 6:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Si `netfilter-persistent` no existe:

```bash
sudo apt-get update
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

Verificá que las reglas quedaron antes del `REJECT`:

```bash
sudo iptables -L INPUT --line-numbers -n
```

> Si tu `REJECT` no está en la línea 6, insertá en la línea que corresponda. Lo importante es que las reglas de 80/443 queden antes del rechazo.

---

## 4. DNS

Creá un registro **A**:

```text
finanzas.tudominio.com → <PUBLIC_IP>
```

Verificá desde tu máquina:

```bash
dig +short finanzas.tudominio.com
```

Tiene que devolver la IP pública de Oracle.

Si no tenés dominio, podés usar `sslip.io`:

```env
DOMAIN=<PUBLIC_IP>.sslip.io
```

Caddy obtiene el certificado igual, siempre que los puertos 80/443 estén abiertos.

> Si usás Cloudflare, dejá el registro en **DNS only** (nube gris) hasta que Caddy obtenga el certificado. Después podés activar el proxy si querés.

---

## 5. Acceso por Tailscale

Si ya administrás la instancia por Tailscale, hay dos formas de usarlo. No son excluyentes.

> **Importante:** Tailscale para SSH **no reemplaza** los puertos 80/443 públicos si querés usar un dominio propio con Caddy. Telegram tiene que llegar al webhook desde Internet. Si querés evitar abrir 80/443, usá la opción B (Tailscale Funnel).

### Opción A (recomendada): Tailscale para SSH + Caddy público

Tailscale se usa solo para entrar a la instancia. El webhook sigue saliendo por tu dominio y Caddy.

1. Instalá Tailscale en el servidor:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
tailscale status
tailscale ip -4
```

`--ssh` habilita Tailscale SSH. Si preferís SSH normal sobre la IP de Tailscale, alcanza con `tailscale up` y dejar `sshd` escuchando en 22; Tailscale te da la conectividad.

2. Desde tu máquina:

```bash
ssh ubuntu@<tailscale-hostname>
# o
ssh ubuntu@100.x.y.z
```

3. En OCI podés **cerrar el puerto 22 público** (o restringirlo a tu IP) y dejar solo 80/443.

> **No te bloquees afuera:** probá primero que `ssh ubuntu@<tailscale-hostname>` funcione y recién después cerrá el 22 público en OCI.

Si usás Tailscale SSH, el tráfico entra por la interfaz `tailscale0`; no hace falta abrir 22 en iptables para la IP pública. Si querés permitir SSH normal sobre Tailscale, agregá:

```bash
sudo iptables -I INPUT 1 -i tailscale0 -p tcp --dport 22 -j ACCEPT
sudo netfilter-persistent save
```

Usamos `-I INPUT 1` para que la regla quede antes del `REJECT` final.

Tailscale usa conexiones salientes UDP 41641 y, si no hay conexión directa, relay DERP. No necesitás abrir puertos de entrada para que funcione. Si querés conexiones directas, podés abrir UDP 41641 en OCI (opcional).

4. Seguí con el deploy normal (sección 6) usando `DOMAIN` + Caddy.

### Opción B: Tailscale Funnel, sin abrir 80/443

Funnel expone un servicio local a Internet con una URL `https://<host>.<tailnet>.ts.net`. Sirve para que Telegram llegue al webhook sin abrir 80/443 ni usar Caddy.

Requisitos:

- Tailscale v1.38.3 o superior.
- MagicDNS y HTTPS habilitados en el tailnet.
- Funnel habilitado en el tailnet. La CLI te guía; también se puede agregar el node attribute `funnel` en Access Controls.
- Funnel es público, está en beta y tiene límites de ancho de banda no configurables. Para un bot personal alcanza.
- Funnel solo puede usar los puertos públicos `443`, `8443` y `10000`; el target local puede ser `3000`.

Pasos:

1. Instalá Tailscale y habilitá Funnel:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale funnel --bg 3000
```

La primera vez te va a pedir aprobar Funnel y habilitar HTTPS/MagicDNS. `--bg` deja Funnel corriendo en background y se reanuda después de un reboot. Al final te muestra la URL pública, por ejemplo:

```text
https://oracle-finanzas.tailxxxx.ts.net
```

Verificá:

```bash
tailscale funnel status
tailscale status
```

2. Desplegá el agente sin Caddy y con el puerto 3000 publicado solo en localhost:

```bash
cd /opt/finanzas-agent
sudo docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d --build
```

El override `docker-compose.tailscale.yml` publica `127.0.0.1:3000:3000` y deja el servicio `caddy` fuera de perfil. No uses el script `setup-vps-ubuntu.sh` en este modo, porque levanta Caddy.

3. Registrá el webhook con la URL de Funnel:

```bash
PUBLIC_URL="https://oracle-finanzas.tailxxxx.ts.net"

curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url":"'"$PUBLIC_URL"'/eve/v1/telegram",
    "secret_token":"'"$TELEGRAM_WEBHOOK_SECRET_TOKEN"'",
    "allowed_updates":["message","callback_query"]
  }'
```

4. En `.env`, `DOMAIN` no lo usa Caddy en este modo. Podés dejarlo con el hostname de Funnel o vacío; el webhook se registra con `PUBLIC_URL`.

5. En OCI podés cerrar 80/443 y 22. Solo necesitás salida a Internet para Tailscale y Telegram. El puerto 3000 no se expone a Internet: escucha en `127.0.0.1` y Funnel lo proxya.

> Funnel es público: cualquiera que conozca la URL puede llegar al webhook. EVE valida el `secret_token` de Telegram y el bot sigue protegido por `ACCESS_CODE`. La URL de Funnel no puede ser un dominio propio; siempre es `*.ts.net`. Si querés `finanzas.tudominio.com`, usá la opción A.

## 6. Instalar y desplegar

En la instancia:

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y git curl
```

Cloná el repo:

```bash
sudo mkdir -p /opt/finanzas-agent
sudo chown -R ubuntu:ubuntu /opt/finanzas-agent
git clone https://github.com/ramiroAlvarez9/finanzas-agent.git /opt/finanzas-agent
cd /opt/finanzas-agent
```

Creá el `.env`:

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Completá:

```env
OPENROUTER_API_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=...
TELEGRAM_WEBHOOK_SECRET_TOKEN=...
ACCESS_CODE=...
ASSEMBLYAI_API_KEY=...
ASSEMBLYAI_LANGUAGE_CODE=es
DATABASE_URL=file:data/finanzas.db
DOMAIN=finanzas.tudominio.com
```

Ejecutá el script de deploy:

```bash
APP_DIR=/opt/finanzas-agent bash docs/plans/setup-vps-ubuntu.sh
```

El script:

- instala Docker y Docker Compose si faltan,
- prepara `data/`, `workflow-data/` y `sandbox-data/`,
- construye y levanta el stack,
- registra el webhook de Telegram con `allowed_updates: ["message", "callback_query"]`.

Si el script se detiene porque acaba de crear `.env`, completá los secretos y volvé a ejecutarlo.

### Alternativa manual

Si ya tenés Docker instalado:

```bash
cd /opt/finanzas-agent
sudo docker compose up -d --build
```

Y registrá el webhook a mano:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url":"https://'"$DOMAIN"'/eve/v1/telegram",
    "secret_token":"'"$TELEGRAM_WEBHOOK_SECRET_TOKEN"'",
    "allowed_updates":["message","callback_query"]
  }'
```

---

## 7. Verificar

```bash
cd /opt/finanzas-agent
sudo docker compose ps
sudo docker compose logs -f agent
```

Desde tu máquina:

```bash
curl -I https://finanzas.tudominio.com
```

Después, en Telegram:

```text
/start <ACCESS_CODE>
```

Y probá:

```text
Gasté 12.500 en el almuerzo
```

Tenés que ver la tarjeta con **✅ Confirmar** y **❌ Cancelar**.

Para revisar el webhook:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

---

## 8. Actualizar la app

```bash
cd /opt/finanzas-agent
git pull
sudo docker compose up -d --build
```

El entrypoint detecta cambios en `agent/` y resetea el estado de sesión, pero **no borra** `data/finanzas.db`.

---

## 9. Backups

Para una copia consistente de SQLite, parar el agente unos segundos:

```bash
cd /opt/finanzas-agent
sudo docker compose stop agent
sudo mkdir -p /var/backups
sudo tar -czf "/var/backups/finanzas-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" data workflow-data
sudo docker compose start agent
```

Restaurar:

```bash
cd /opt/finanzas-agent
sudo docker compose stop agent
sudo tar -xzf /var/backups/finanzas-<fecha>.tar.gz
sudo docker compose start agent
```

Podés programar el backup con cron, pero asegurate de que el usuario que lo ejecuta tenga permiso sobre Docker.

---

## 10. Si la instancia tiene poca RAM

La compilación de la imagen puede quedarse sin memoria en la instancia AMD micro de 1 GB. Agregá swap:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Después volvé a correr:

```bash
cd /opt/finanzas-agent
sudo docker compose up -d --build
```

---

## 11. Troubleshooting

### Caddy no obtiene el certificado

Revisá:

```bash
dig +short finanzas.tudominio.com
sudo ss -tlnp | grep -E ':80|:443'
sudo docker compose logs caddy
```

Causas comunes:

- el registro DNS no apunta a la IP pública,
- falta abrir 80/443 en la Security List de OCI,
- falta abrir 80/443 en iptables/ufw de Ubuntu,
- otro servicio está usando 80/443 en el host.

### `502 Bad Gateway`

El contenedor de la app no está sano:

```bash
sudo docker compose ps
sudo docker compose logs -f agent
```

### El bot no responde

- Verificá `getWebhookInfo`.
- Confirmá que mandaste `/start <ACCESS_CODE>`.
- Revisá que `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` y `TELEGRAM_WEBHOOK_SECRET_TOKEN` sean del bot nuevo.
- Sin `callback_query` en `allowed_updates`, los botones no funcionan.

### La voz no funciona

- Verificá `ASSEMBLYAI_API_KEY`.
- Revisá los logs: si AssemblyAI falla, el bot avisa que no pudo entender el audio.

### No hay datos después de un redeploy

- Confirmá que el volumen `./data` existe y que `DATABASE_URL=file:data/finanzas.db`.
- No borres `data/` al actualizar.

---

## 12. Checklist de seguridad

- [ ] SSH (22) restringido a tu IP en OCI.
- [ ] `ACCESS_CODE` largo y secreto.
- [ ] `.env` con permisos `600`.
- [ ] Puerto 3000 no expuesto a Internet.
- [ ] Backups de `data/` probados.
- [ ] `DOMAIN` con HTTPS funcionando.
- [ ] Webhook con `callback_query`.

---

## 13. Si ya tenés otro Caddy en el mismo servidor

Este repo trae su propio servicio `caddy`, que ocupa 80/443. Si en la misma instancia ya corre otro Caddy:

1. No levantes el servicio `caddy` de este compose.
2. Conectá el contenedor `agent` a la red del Caddy existente.
3. Agregá un bloque en el Caddyfile existente:

```caddyfile
finanzas.tudominio.com {
    reverse_proxy finanzas-agent:3000
}
```

4. Reiniciá el Caddy existente.

Si podés, lo más simple es usar una instancia separada para este bot.
