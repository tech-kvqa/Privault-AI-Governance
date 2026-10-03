#!/usr/bin/env bash
set -e
trap 'docker compose -f qa/docker-compose.qa.yml down -v' EXIT
docker compose -f qa/docker-compose.qa.yml up --build --abort-on-container-exit --exit-code-from qa
