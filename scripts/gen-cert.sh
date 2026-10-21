#!/usr/bin/env bash
# ============================================================
# gen-cert.sh - Generar certificado TLS autofirmado para la IP publica
# ------------------------------------------------------------
# Crea un certificado + clave AUTOFIRMADOS con openssl que incluyen la IP
# publica tanto en el CN como en el subjectAltName (SAN con IP:...). Caddy
# luego sirve ESTE certificado explicitamente (directiva `tls <crt> <key>`),
# en vez de depender de su CA interna.
#
# POR QUE: la CA interna de Caddy (`tls internal` / `local_certs`) no lograba
# completar el handshake por IP publica sin SNI (alert "internal error", 592).
# Un certificado explicito servido en un sitio por puerto (:443) se presenta
# siempre, con o sin SNI, lo que resuelve el acceso por https://64.177.92.121.
#
# Uso (en el servidor Ubuntu, en la raiz del repo):
#   bash scripts/gen-cert.sh
#   # o:  ./scripts/gen-cert.sh
#
# Salida: certs/selfsigned.crt y certs/selfsigned.key (carpeta certs/ en la
# raiz del repo, ignorada por git para no versionar la clave privada).
# ============================================================
set -eu

# IP publica del servidor. Cambia este valor si tu IP cambia.
IP="64.177.92.121"

# Directorio y rutas de salida (relativas a la raiz del repo).
# El script se ubica en scripts/, asi que subimos un nivel.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CERT_DIR="$REPO_ROOT/certs"
CRT="$CERT_DIR/selfsigned.crt"
KEY="$CERT_DIR/selfsigned.key"

mkdir -p "$CERT_DIR"

# No sobreescribir en silencio: si ya existen, avisar y salir.
if [ -f "$CRT" ] || [ -f "$KEY" ]; then
	echo "Ya existe un certificado en $CERT_DIR:"
	[ -f "$CRT" ] && echo "  - $CRT"
	[ -f "$KEY" ] && echo "  - $KEY"
	echo
	echo "Para regenerarlo, borralo primero y vuelve a ejecutar este script:"
	echo "  rm -f \"$CRT\" \"$KEY\" && bash scripts/gen-cert.sh"
	exit 0
fi

echo "Generando certificado autofirmado para IP=$IP ..."

# Un solo comando no interactivo. El SAN DEBE incluir la IP (IP:$IP): ese es
# el dato que hace que el navegador/cliente acepte la conexion por IP.
openssl req -x509 -newkey rsa:2048 -nodes \
	-keyout "$KEY" \
	-out "$CRT" \
	-days 3650 \
	-subj "/CN=$IP" \
	-addext "subjectAltName=IP:$IP,DNS:localhost,IP:127.0.0.1"

# Permisos restrictivos para la clave privada.
chmod 600 "$KEY"

echo
echo "Certificado creado:"
echo "  - $CRT"
echo "  - $KEY (valido ~10 anios, CN=$IP, SAN IP:$IP)"
echo
echo "Siguientes pasos (recrear el proxy para que tome el certificado):"
echo "  docker compose up -d --force-recreate --no-deps proxy"
echo "  # o levantar todo el stack:  docker compose up -d"
echo
echo "Luego verifica desde el servidor:"
echo "  curl -k -I https://$IP   # espera HTTP/2 200 o 302"
