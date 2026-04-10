FROM node:20-slim
WORKDIR /app
COPY dist/ ./dist/
COPY package.json ./
RUN npm install --production
EXPOSE 3000
CMD ["node", "dist/index.js"]
