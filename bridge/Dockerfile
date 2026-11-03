FROM node:22-alpine
WORKDIR /app
COPY server.cjs ./server.cjs
USER node
EXPOSE 8787
CMD ["node", "server.cjs"]
