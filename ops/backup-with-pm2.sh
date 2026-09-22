#!/usr/bin/env bash
set -euo pipefail
export PM2_HOME=/home/service/.pm2

status=$(/usr/bin/pm2 jlist | /usr/bin/node -e '
  let input="";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const app = JSON.parse(input).find(item => item.name === "file");
    if (!app) process.exit(2);
    process.stdout.write(app.pm2_env.status);
  });
')

resume() {
  if [[ "$status" == online ]]; then
    /usr/bin/pm2 restart file >/dev/null
  fi
}
trap resume EXIT

if [[ "$status" == online ]]; then
  /usr/bin/pm2 stop file >/dev/null
fi
/usr/bin/node /home/service/tpass-file/ops/backup.mjs
