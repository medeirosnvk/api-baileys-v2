export class Logger {
  private static getTimestamp(): string {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "medium",
    });

    return formatter.format(now);
  }

  static info(message: string, data?: any) {
    console.log(`[${this.getTimestamp()}] [INFO] ${message}`, data || "");
  }

  static error(message: string, error?: any) {
    console.error(`[${this.getTimestamp()}] [ERROR] ${message}`, error || "");
  }

  static warn(message: string, data?: any) {
    console.warn(`[${this.getTimestamp()}] [WARN] ${message}`, data || "");
  }

  static success(message: string, data?: any) {
    console.log(`[${this.getTimestamp()}] [SUCCESS] ${message}`, data || "");
  }
}
