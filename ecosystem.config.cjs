const path = require('path');

module.exports = {
  apps: [
    {
      name: 'soma-core',
      script: 'server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      restart_delay: 5000,
      max_restarts: 10,
      autorestart: true
    },
    {
      name: 'max-engine',
      script: 'launcher.mjs',
      args: '--mode api --port 3100',
      cwd: path.resolve(__dirname, '..', 'MAX'),
      env: {
        NODE_ENV: 'production',
        PORT: 3100
      },
      restart_delay: 5000,
      max_restarts: 10,
      autorestart: true
    }
  ]
};
