FROM node:16-alpine

WORKDIR /app

EXPOSE 8800

COPY package*.json ./

RUN npm install