import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const defaultDbConfig = {
  host: process.env.DB2_MY_SQL_HOST,
  user: process.env.MY_SQL_USER,
  password: process.env.DB2_MY_SQL_PASSWORD,
  port: process.env.MY_SQL_PORT,
  database: process.env.DB2_MY_SQL_DATABASE,
  connectionLimit: process.env.MY_SQL_CONNECTION_LIMIT,
  charset: process.env.MY_SQL_CHARSET,
};

export const createConnection = async (dbConfig: any) => {
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

export const executeQuery = async (
  sql: any,
  customDbConfig = defaultDbConfig
) => {
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
