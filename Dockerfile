# One container: builds the web app (which bundles the Python engine for Pyodide), then serves it
# as static files with nginx as an unprivileged user. Nothing executes user code on the server.
#
#   docker build -t warehouse-testbed .
#   docker compose up -d          (see compose.yaml for CPU/RAM limits and hardening)

# ---- build ------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:stable-alpine
WORKDIR /src
# The frontend bundles ../engine/src/warehouse_sim/**/*.py at build time.
COPY engine/src ./engine/src
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend ./frontend
RUN cd frontend && npm run build

# ---- serve ------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY deploy/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /src/frontend/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
