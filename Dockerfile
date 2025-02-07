FROM node:14

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./

RUN npm install

# Bundle app source
COPY . .

# Port (Informational)
EXPOSE 3010

CMD [ "node", "server.js" ]