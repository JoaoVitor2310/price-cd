import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { SupplierRepository, SupplierRow, TopicRow } from "@/application/suppliers/ports/supplier-repository.port.js";

const DB_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "suppliers.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS suppliers (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    steam_id  TEXT    NOT NULL UNIQUE,
    is_added  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS topics (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    code        TEXT    NOT NULL UNIQUE,
    status      TEXT    NOT NULL,
    result      TEXT,
    executed_at TEXT    DEFAULT (datetime('now'))
);
`;

export class SqliteSupplierRepository implements SupplierRepository {
    private readonly db: Database.Database;

    constructor(dbPath: string = DB_PATH) {
        if (dbPath !== ":memory:") {
            fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        }
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.exec(SCHEMA);
    }

    findSupplierBySteamId(steamId: string): SupplierRow | null {
        return (
            (this.db
                .prepare("SELECT * FROM suppliers WHERE steam_id = ?")
                .get(steamId) as SupplierRow | undefined) ?? null
        );
    }

    upsertSupplier(steamId: string): number {
        this.db
            .prepare("INSERT OR IGNORE INTO suppliers (steam_id) VALUES (?)")
            .run(steamId);

        const row = this.db
            .prepare("SELECT id FROM suppliers WHERE steam_id = ?")
            .get(steamId) as { id: number };

        return row.id;
    }

    saveTopic(topic: Omit<TopicRow, "id" | "executed_at">): void {
        this.db
            .prepare(
                `INSERT INTO topics (supplier_id, code, status, result)
                 VALUES (@supplier_id, @code, @status, @result)`
            )
            .run(topic);
    }
}
