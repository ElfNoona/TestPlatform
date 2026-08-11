FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN mkdir -p uploads
EXPOSE 7000
CMD ["node", "src/index.js"]
