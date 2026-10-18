FROM node:20-alpine

# Non-root user required by Hugging Face Spaces (UID 1000)
USER node
WORKDIR /home/node/app

COPY --chown=node:node package*.json ./
RUN npm install --omit=dev

COPY --chown=node:node . .

EXPOSE 7860

ENV PORT=7860
ENV NODE_ENV=production

CMD ["npm", "start"]
