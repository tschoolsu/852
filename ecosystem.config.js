const path = require('node:path');

module.exports = {
  apps: [{
    name: 'file',
    cwd: __dirname,
    script: path.join(__dirname, 'node_modules/next/dist/bin/next'),
    args: 'start -H 127.0.0.1 -p 3005',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '1G',
    env: { NODE_ENV: 'production' },
  }],
};
