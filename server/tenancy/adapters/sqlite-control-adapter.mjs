import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const toParams = (value) => (Array.isArray(value) ? value : []);

const mapRows = (rows) => rows.map((row) => ({ ...row }));

export const createSqliteControlAdapter = async (config = {}) => {
  const file = String(config.file ?? "").trim() || path.join(process.cwd(), "data", "mindgraph-control.sqlite");
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys=ON;");

  const execute = async (sql, params = []) => {
    const statement = db.prepare(sql);
    const result = statement.run(...toParams(params));
    return {
      changes: Number(result?.changes ?? 0)
    };
  };

  const queryAll = async (sql, params = []) => {
    const statement = db.prepare(sql);
    const rows = statement.all(...toParams(params));
    return mapRows(rows);
  };

  const queryOne = async (sql, params = []) => {
    const statement = db.prepare(sql);
    const row = statement.get(...toParams(params));
    return row ? { ...row } : null;
  };

  const transaction = async (handler) => {
    db.exec("BEGIN");
    try {
      const tx = {
        execute,
        queryAll,
        queryOne
      };
      const value = await handler(tx);
      db.exec("COMMIT");
      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  return {
    client: "sqlite",
    execute,
    queryAll,
    queryOne,
    transaction,
    close: async () => {
      db.close();
    }
  };
};
