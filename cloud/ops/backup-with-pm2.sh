#!/usr/bin/env bash
set -euo pipefail
export PM2_HOME=/home/service/.pm2

status=$(/usr/bin/pm2 jlist | /usr/bin/node -e '
  let input="";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const app = JSON.parse(input).find(item => item.name === "t-files");
    if (!app) process.exit(2);
    process.stdout.write(app.pm2_env.status);
  });
')

resume() {
  if [[ "$status" == online ]]; then
    /usr/bin/pm2 restart t-files >/dev/null
  fi
}
trap resume EXIT

if [[ "$status" == online ]]; then
  /usr/bin/pm2 stop t-files >/dev/null
fi
/usr/bin/node /home/service/t-files/cloud/ops/backup.mjs
