# M0: trivial image. Becomes a multi-stage TypeScript build in M1 (see PLAN.md).
FROM node:22-bookworm-slim
WORKDIR /app
COPY server.mjs .
ENV PORT=3000 HOST=0.0.0.0
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
