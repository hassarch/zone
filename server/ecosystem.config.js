module.exports = {
  apps: [
    {
      name: 'zone-server',
      script: './server.js',
      instances: process.env.PM2_INSTANCES || 1,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 3033
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3033
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 10000,
      kill_timeout: 5000,
      wait_ready: true,
      shutdown_with_message: true
    }
  ]
};
