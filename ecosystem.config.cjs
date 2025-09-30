module.exports = {
  apps: [
    {
      name: "api-baileys",
      script: "npm",
      args: "run start",
      watch: false,
      autorestart: true, // Reinicia automaticamente se cair
      max_restarts: 10, // Máximo de tentativas de restart
      restart_delay: 5000, // Delay entre reinícios (ms)
      error_file: "./logs/err.log", // Log de erros
      out_file: "./logs/out.log", // Log de saída
      combine_logs: true, // Junta logs
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
