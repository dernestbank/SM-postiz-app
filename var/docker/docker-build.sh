#!/bin/bash

set -o xtrace

docker rmi localhost/postiz:latest || true
docker pull ghcr.io/gitroomhq/postiz-app:latest
docker build -t localhost/postiz:latest -f var/docker/Dockerfile.quantgist-local.patch .
