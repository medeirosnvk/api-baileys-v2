module.exports = {
  apps: [
    {
      name: "api-baileys",
      script: "npm",
      args: "run start",
      cwd: "/home/deploy/api-baileys-v2", // 👈 caminho absoluto da pasta do projeto
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      combine_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
