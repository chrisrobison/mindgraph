const toParams = (value) => (Array.isArray(value) ? value : []);

export const createMySqlControlAdapter = async (config = {}) => {
  let mysql = null;
  try {
    mysql = await import("mysql2/promise");
  } catch {
    throw new Error(
      "MySQL adapter requested, but dependency 'mysql2' is not installed. Install it with: npm install mysql2"
    );
  }

  const pool = mysql.createPool({
    host: String(config.host ?? "127.0.0.1"),
    port: Number(config.port ?? 3306),
    user: String(config.user ?? ""),
    password: String(config.password ?? ""),
    database: String(config.database ?? ""),
    connectionLimit: 8,
    waitForConnections: true
  });

  const execute = async (sql, params = []) => {
    const [result] = await pool.execute(sql, toParams(params));
    return {
      changes: Number(result?.affectedRows ?? 0)
    };
  };

  const queryAll = async (sql, params = []) => {
    const [rows] = await pool.execute(sql, toParams(params));
    return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  };

  const queryOne = async (sql, params = []) => {
    const rows = await queryAll(sql, params);
    return rows[0] ?? null;
  };

  const transaction = async (handler) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const tx = {
        execute: async (sql, params = []) => {
          const [result] = await conn.execute(sql, toParams(params));
          return { changes: Number(result?.affectedRows ?? 0) };
        },
        queryAll: async (sql, params = []) => {
          const [rows] = await conn.execute(sql, toParams(params));
          return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
        },
        queryOne: async (sql, params = []) => {
          const [rows] = await conn.execute(sql, toParams(params));
          return Array.isArray(rows) && rows.length ? { ...rows[0] } : null;
        }
      };
      const value = await handler(tx);
      await conn.commit();
      return value;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  };

  return {
    client: "mysql",
    execute,
    queryAll,
    queryOne,
    transaction,
    close: async () => {
      await pool.end();
    }
  };
};
