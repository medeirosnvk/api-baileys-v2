module.exports = {
  apps: [
    {
      name: "api-baileys",
      script: "node",
      args: ["--import", "tsx", "src/server.ts"],
      watch: false,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000,
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      combine_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
