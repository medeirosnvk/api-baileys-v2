module.exports = {
  apps: [
    {
      name: "api-baileys",
      script: "./node_modules/.bin/tsx", // garante uso do TSX local
      args: "src/server.ts", // caminho do seu servidor TS
      watch: false,
      autorestart: true,
      max_restarts: 10,
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
