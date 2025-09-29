module.exports = {
  apps: [
    {
      name: "api-baileys",
      script: "src/server.ts", // o arquivo principal
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      instances: 1,
      exec_mode: "fork",
      kill_timeout: 3000,
      interpreter: "node", // Node vai interpretar o TS via loader
      node_args: "--loader ts-node/esm", // necessário para ESM + TS
    },
  ],
};
