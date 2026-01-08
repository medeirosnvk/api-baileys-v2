import mysql from "mysql2/promise";
require("dotenv").config();

const defaultDbConfig = {
  host: process.env.DB_MY_SQL_HOST || "localhost",
  user: process.env.MY_SQL_USER || "root",
  password: process.env.DB_MY_SQL_PASSWORD || "",
  port: parseInt(process.env.MY_SQL_PORT || "3306", 10),
  database: process.env.DB_MY_SQL_DATABASE || "test",
  connectionLimit: parseInt(process.env.MY_SQL_CONNECTION_LIMIT || "10", 10),
  charset: process.env.MY_SQL_CHARSET || "utf8mb4",
};

const createConnection = async (dbConfig: {
  host: string;
  user: string;
  password: string;
  port: number;
  database: string;
  connectionLimit: number;
  charset: string;
}) => {
  try {
    const connection = await mysql.createConnection({
      ...dbConfig,
      connectTimeout: 60000,
    });
    return connection;
  } catch (error) {
    console.error("Erro ao conectar ao banco de dados:", error);
    throw error;
  }
};

const executeQueryChat = async (sql: any, customDbConfig = defaultDbConfig) => {
  let connection;

  try {
    connection = await createConnection(customDbConfig);
    const [rows, fields] = await connection.execute(sql);
    return rows;
  } catch (error) {
    console.error("Erro ao executar a consulta:", error);
    throw error;
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch (error) {
        console.error(
          "Erro ao encerrar a conexão com o banco de dados:",
          error
        );
      }
    }
  }
};

export { executeQueryChat };
