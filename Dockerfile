FROM ubuntu:20.04

# Install dependencies
RUN apt-get update && \
    apt-get install -y build-essential python3-pip net-tools iputils-ping iproute2 curl

# Install Node.js using NodeSource repository
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs

# Install global npm packages
RUN npm install -g nodemon mediasoup

# Expose ports
EXPOSE 3000
EXPOSE 2000-2020


# Set working directory
WORKDIR /app

COPY .  .

# Navigate to the webrtc directory
WORKDIR /app/webrtc

# Install dependencies
RUN npm install