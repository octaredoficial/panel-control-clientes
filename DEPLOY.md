# DEPLOY.md — Despliegue autohospedado en el servidor Vultr

Guía paso a paso para levantar el **Panel de Control de Clientes** en tu propio
servidor **Vultr Ubuntu** (IP pública `64.177.92.121`, 1 vCPU / 1 GB RAM), con
**Docker Compose**, **HTTPS autofirmado** (acceso solo por IP, sin dominio) y la
base de datos **SQLite embebida** en un volumen.

El stack son dos contenedores:

- **app** — backend Node 22 (SQLite + REST + WebSocket + login de contraseña
  única). No publica puertos: solo lo alcanza Caddy por la red interna.
- **proxy** — Caddy, termina **HTTPS autofirmado** sirviendo un certificado
  **explícito** generado con `openssl` (ver `scripts/gen-cert.sh`) que incluye
  la IP en su `subjectAltName`, y hace de reverse proxy hacia `app`. Es el único
  que expone puertos (**80** y **443**).

> La arquitectura y las decisiones (por qué WebSocket, SQLite, Caddy, etc.) están
> en [`MIGRATION.md`](./MIGRATION.md). Este documento es la **operativa**.

---

## 0. Antes de empezar: no romper la VPN del MikroTik

Tu Vultr ya corre una **VPN hacia el MikroTik**. Este stack está diseñado para
**convivir** con ella sin tocarla:

- **No usa `network_mode: host`.** Cada servicio vive en una red *bridge* interna
  de Docker (`pcc-net`); no se mete en la red del host.
- **Solo publica 80 y 443** (los del proxy Caddy). Si tu VPN usa esos puertos
  (no es lo normal: WireGuard suele usar UDP 51820, OpenVPN UDP 1194), avísame y
  cambiamos el mapeo en `docker-compose.yml`.
- **No toca rutas, interfaces ni `iptables` del host** más allá de lo que Docker
  gestiona para sus propios contenedores.

Comprueba **antes** qué escucha el host, para confirmar que 80/443 están libres:

```bash
sudo ss -tulpn | grep -E ':(80|443)\b' || echo "80 y 443 libres"
# Y revisa que tu VPN sigue arriba (ajusta el nombre de interfaz):
ip -brief addr show | grep -Ei 'wg|tun|ppp' || echo "(revisa tu interfaz VPN)"
```

Anota la salida; al final volveremos a verificar que la VPN sigue intacta.

---

## 1. Instalar Docker + Compose (si faltan)

```bash
# Docker Engine + plugin de Compose (repos oficiales de Docker para Ubuntu):
curl -fsSL https://get.docker.com | sudo sh

# Comprueba que el plugin de compose está disponible (v2, subcomando):
docker compose version
```

Si `docker compose version` responde con una versión, estás listo. (Opcional:
`sudo usermod -aG docker $USER` y reinicia sesión para no usar `sudo`.)

---

## 2. Clonar el repositorio

```bash
cd /opt            # o donde prefieras alojarlo
sudo git clone <URL-de-tu-repo> panel-control-clientes
cd panel-control-clientes
```

---

## 3. Crear el archivo `.env` con tus secretos

```bash
cp .env.example .env
```

Edita `.env` y pon valores **reales**:

- `APP_PASSWORD` — tu contraseña única de acceso (elige una fuerte).
- `SESSION_SECRET` — una cadena larga y aleatoria. Genérala con:

  ```bash
  openssl rand -hex 32
  # (o, si tienes Node:)  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

  Copia el resultado como valor de `SESSION_SECRET`.

- `DB_PATH=/data/pcc.sqlite` y `PORT=8080` — déjalos como están (son rutas y
  puertos **internos** del contenedor).

> `.env` está en `.gitignore`: **no se sube al repo**. Guárdalo solo en el
> servidor.

---

## 4. Generar el certificado autofirmado (antes de levantar el stack)

Caddy sirve un certificado **autofirmado explícito** que debes generar una vez
en el servidor. El script lo crea con `openssl` incluyendo la IP pública tanto
en el `CN` como en el `subjectAltName` (clave para que el handshake por IP
funcione):

```bash
bash scripts/gen-cert.sh
# o, si tiene el bit de ejecución:  ./scripts/gen-cert.sh
```

Esto crea `certs/selfsigned.crt` y `certs/selfsigned.key` (carpeta `certs/` en
la raíz del repo), que cubren `IP:64.177.92.121`, `localhost` y `127.0.0.1`.

- Si tu IP pública es distinta, edita la variable `IP` al inicio de
  `scripts/gen-cert.sh` antes de ejecutarlo.
- La carpeta `certs/` está en `.gitignore`: la **clave privada nunca se sube**
  al repo; vive solo en el servidor.
- El navegador seguirá **avisando una vez** de que el certificado no es de
  confianza (es autofirmado): es lo esperado, acéptalo (ver paso 6).
- Para **regenerarlo**, borra los archivos y vuelve a ejecutar el script:
  `rm -f certs/selfsigned.crt certs/selfsigned.key && bash scripts/gen-cert.sh`.

> El `docker-compose.yml` monta `./certs` dentro del contenedor del proxy en
> `/etc/caddy/certs` (solo lectura), que es la ruta que referencia la directiva
> `tls` del `Caddyfile`.

---

## 5. Construir y levantar el stack

```bash
docker compose up -d --build
```

Esto construye la imagen del backend y arranca `app` + `proxy` en segundo plano.
Comprueba el estado:

```bash
docker compose ps
```

Debes ver los dos servicios `running`. El `proxy` escuchando en `0.0.0.0:80` y
`0.0.0.0:443`.

---

## 6. Abrir la app y aceptar el certificado autofirmado

En tu móvil o PC, abre:

```
https://64.177.92.121
```

- El navegador **avisará una vez** de que el certificado no es de confianza
  (es **autofirmado**, generado con `openssl` en el paso 4: es lo esperado al
  no tener dominio). Acepta la advertencia:
  - **Chrome/Edge:** «Configuración avanzada» → «Continuar a 64.177.92.121».
  - **Firefox:** «Avanzado» → «Aceptar el riesgo y continuar».
  - **Safari/iOS:** «Mostrar detalles» → «visitar este sitio web».
- Si entras por `http://64.177.92.121`, Caddy te **redirige** automáticamente a
  `https://`.
- Verás el **formulario de contraseña única** (tras FEAT-004). Entra con tu
  `APP_PASSWORD`.

La **sincronización en vivo** funciona sola: abre la app en el móvil y en el PC
a la vez; los cambios en uno aparecen en el otro **sin recargar** (vía WebSocket
sobre `wss://`, que Caddy proxya de forma nativa).

---

## 7. Operación diaria

```bash
# Ver logs (todo el stack, o un servicio):
docker compose logs -f
docker compose logs -f app
docker compose logs -f proxy

# Reiniciar / parar / arrancar:
docker compose restart
docker compose down          # para y elimina los contenedores (NO los volúmenes)
docker compose up -d         # vuelve a levantar

# Actualizar tras un git pull:
git pull
docker compose up -d --build
# Si solo cambiaste el Caddyfile o regeneraste el certificado, basta recrear
# el proxy:
docker compose up -d --force-recreate --no-deps proxy
```

Los contenedores tienen `restart: unless-stopped`, así que **vuelven a arrancar
solos** si el servidor se reinicia.

### Copia de seguridad de la base de datos

Los datos viven en el volumen `pcc-data` (archivo `pcc.sqlite`). Para respaldar:

```bash
# Copia el .sqlite del volumen a un archivo local con fecha:
docker compose cp app:/data/pcc.sqlite ./pcc-backup-$(date +%F).sqlite
```

Guarda ese archivo fuera del servidor. Restaurar es copiar el archivo de vuelta
al volumen y reiniciar `app`.

---

## 8. Verificar que la VPN del MikroTik sigue intacta

Tras levantar el stack, repite las comprobaciones del paso 0:

```bash
ip -brief addr show | grep -Ei 'wg|tun|ppp'     # tu interfaz VPN sigue UP
sudo ss -tulpn | grep -E ':(80|443)\b'          # solo Caddy ocupa 80/443
ping -c1 <IP-del-MikroTik-por-la-VPN>            # el túnel responde
```

Si todo responde igual que antes, la migración **no interrumpió** la VPN.

---

## 9. Resolución de problemas

- **`docker compose up` falla al construir:** confirma que corres el comando en
  la **raíz del repo** (donde está `docker-compose.yml`) y que existe `.env`.
- **El proxy no arranca / error de TLS por cert ausente:** asegúrate de haber
  ejecutado `bash scripts/gen-cert.sh` (paso 4), que existan
  `certs/selfsigned.crt` y `certs/selfsigned.key`, y recrea el proxy con
  `docker compose up -d --force-recreate --no-deps proxy`. Verifica desde el
  propio servidor: `curl -k -I https://64.177.92.121` (debe responder `HTTP/2
  200` o `302`).
- **El navegador no abre `https://64.177.92.121`:** revisa el firewall de Vultr
  (panel web) para permitir **TCP 80 y 443** entrantes, y que `docker compose ps`
  muestre el `proxy` en `running`.
- **«Contraseña incorrecta»:** el valor es el `APP_PASSWORD` de tu `.env`; tras
  cambiarlo, `docker compose up -d` para recargar la env del contenedor.
- **Advertencia de certificado en cada visita:** es normal con cert autofirmado;
  puedes importar `certs/selfsigned.crt` como certificado de confianza en tu
  dispositivo si quieres evitarla (opcional), pero no es necesario.
- **Poca RAM:** el stack trae límites modestos (`app` 256 MB, `proxy` 128 MB). Si
  `docker compose` de tu versión ignora `mem_limit`, no pasa nada; el consumo
  real es bajo para 30–50 clientes.
