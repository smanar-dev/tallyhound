# One image for the web service and the timer. TH_ROLE=web or TH_ROLE=worker runs one of them; unset runs both.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /app /app
# Not root: the service needs no write access to its own files.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/server/src/main.ts"]
