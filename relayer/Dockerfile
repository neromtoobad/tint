# Tint relayer image. Build from the repo root (it needs ../sdk and the
# deployments file):  tools/deploy-relayer.sh stages exactly these paths.
FROM node:22-slim
WORKDIR /app
COPY sdk/package.json sdk/package-lock.json* sdk/
COPY sdk/src sdk/src
COPY contracts/deployments/46630.json contracts/deployments/46630.json
COPY relayer/package.json relayer/package-lock.json relayer/
COPY relayer/src relayer/src
WORKDIR /app/relayer
RUN npm ci --omit=dev
ENV DEPLOYMENT=../contracts/deployments/46630.json TRUST_PROXY=1
CMD ["node", "src/server.js"]
