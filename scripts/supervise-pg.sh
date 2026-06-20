#!/bin/bash
# Supervise PostgreSQL - keep it running forever
set -e
source /home/z/.setup_env.sh

PG_BIN=/home/z/my-project/node_modules/@embedded-postgres/linux-x64/native/bin/postgres
PG_DATA=/home/z/my-project/data/db
PG_PORT=5433

while true; do
  echo "[$(date)] Starting PostgreSQL..."
  $PG_BIN -D $PG_DATA -p $PG_PORT -h 0.0.0.0 >> /tmp/pg-server.log 2>&1
  EXIT_CODE=$?
  echo "[$(date)] PostgreSQL exited with code $EXIT_CODE, restarting in 2s..."
  sleep 2
done
