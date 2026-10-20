# ============================================================
# Panel de Control de Clientes - Imagen del backend (Node 22)
# ------------------------------------------------------------
# Imagen ligera (node:22-alpine) pensada para el box de 1 GB de RAM.
# El servidor (server/server.js) sirve el frontend estatico desde la
# RAIZ del repo, que es `path.resolve(__dirname, "..")`, es decir el
# directorio padre de server/. Por eso dentro de la imagen replicamos
# ese mismo layout: el codigo del backend en /app/server y los
# archivos estaticos del frontend en /app.
#
# El backend NO tiene dependencias de npm (usa solo modulos integrados
# de Node 22: node:sqlite, node:http, node:crypto). Aun asi respetamos
# el flujo estandar: si existe package-lock.json corremos
# `npm ci --omit=dev`; si no, no hay nada que instalar.
#
# El contexto de build es la RAIZ del repo (asi este Dockerfile ve
# index.html, app.js, etc.). Se referencia con:
#   docker build -f server/Dockerfile .
# docker-compose.yml ya fija context: . y dockerfile: server/Dockerfile.
# .dockerignore (en la raiz) excluye .git, node_modules, .env, el .sqlite
# local, firebase-sync.js (obsoleto tras FEAT-004) y los archivos de doc.
#
# Requiere Node >= 22.5 por el modulo experimental `node:sqlite`.
# node:22-alpine cumple ese minimo.
# ============================================================

FROM node:22-alpine

# Directorio de la app: la "raiz del repo" dentro de la imagen.
WORKDIR /app

# --- Dependencias del backend (cache de capas) --------------------------
# Copiamos solo el manifiesto primero para aprovechar la cache.
COPY server/package*.json ./server/
# `npm ci` necesita package-lock.json; como el backend no tiene
# dependencias, instalamos solo si existe el lock. Si no, no hace falta.
RUN if [ -f ./server/package-lock.json ]; then \
      cd server && npm ci --omit=dev; \
    else \
      echo "sin package-lock: el backend no tiene dependencias de npm"; \
    fi

# --- Resto del repo (backend + frontend estatico) -----------------------
# .dockerignore recorta lo que no debe entrar (git, node_modules, .env,
# *.sqlite, docs, firebase-sync.js, etc.), asi este COPY trae a la vez
# el codigo del servidor (server/) y los estaticos del frontend
# (index.html, app.js, red-mapa.js, styles.css y, tras FEAT-004,
# backend-sync.js) con el layout que el servidor espera.
COPY . .

# Directorio del volumen de datos (archivo SQLite). Lo creamos y se lo
# damos al usuario no-root para que pueda escribir el .sqlite.
RUN mkdir -p /data && chown -R node:node /data /app

# El puerto interno del backend (Caddy lo proxya; NO se publica al host).
EXPOSE 8080

# Valores por defecto; .env / docker-compose pueden sobreescribirlos.
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/pcc.sqlite

# Corremos como usuario no-root (la imagen oficial trae el usuario `node`).
USER node

# Entrypoint: el servidor. index.js lee la config de las env vars.
WORKDIR /app/server
CMD ["node", "index.js"]
