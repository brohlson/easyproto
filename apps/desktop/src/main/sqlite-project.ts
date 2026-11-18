import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { link, mkdtemp, open, realpath, rm, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { artboardLimit, manifestSchema, type Manifest, type Source } from "../shared/model";
import { tokenByteLimit } from "../shared/token-types";
import type { Asset, Snapshot } from "./project";

const applicationId = 0x4550524f;
const containerVersion = 1;
const mebibyte = 1024 * 1024;
const fileLimit = 768 * mebibyte;
const metadataLimit = 32 * mebibyte;
const journalMagic = Buffer.from("d9d505f920a163d7", "hex");
const tables = {
  project: `CREATE TABLE project (
    id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL, metadata TEXT NOT NULL,
    token_document TEXT, token_css TEXT
  ) STRICT`,
  source: `CREATE TABLE source (digest TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT`,
  board: `CREATE TABLE board (
    id TEXT PRIMARY KEY, position INTEGER NOT NULL, metadata TEXT NOT NULL,
    html_digest TEXT NOT NULL REFERENCES source(digest), css_digest TEXT NOT NULL REFERENCES source(digest)
  ) STRICT`,
  receipt: `CREATE TABLE receipt (
    position INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, result TEXT NOT NULL
  ) STRICT`,
  asset: `CREATE TABLE asset (
    position INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, bytes BLOB NOT NULL
  ) STRICT`,
};
const indexedTables = ["source", "board", "receipt", "asset"];

type SqliteSnapshot = {
  identity: SqliteIdentity;
  name: string;
  manifest: Manifest;
  sources: Map<string, Source>;
  assets: Map<string, Asset>;
  tokens?: { document: string; css: string };
};
export type SqliteIdentity = { dev: bigint; ino: bigint };

const sourceDigest = (body: string) => createHash("sha256").update(body).digest("hex");
const invalid = () => new Error("The file is not a supported Easy Proto project.");

function projectRow(db: DatabaseSync) {
  const row = db
    .prepare("SELECT name, metadata, token_document, token_css FROM project WHERE id = 1")
    .get();
  if (!row || typeof row.metadata !== "string" || typeof row.name !== "string" || !row.name)
    throw invalid();
  return {
    name: row.name,
    metadata: JSON.parse(row.metadata),
    tokenDocument: row.token_document,
    tokenCss: row.token_css,
  };
}

function verifyFormat(db: DatabaseSync) {
  if (
    db.prepare("PRAGMA application_id").get()?.application_id !== applicationId ||
    db.prepare("PRAGMA user_version").get()?.user_version !== containerVersion ||
    db.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete" ||
    db.prepare("PRAGMA encoding").get()?.encoding !== "UTF-8"
  )
    throw invalid();
  const expected = new Map<string, { type: string; table: string; sql: string | null }>();
  for (const [name, sql] of Object.entries(tables))
    expected.set(name, { type: "table", table: name, sql });
  for (const table of indexedTables)
    expected.set(`sqlite_autoindex_${table}_1`, { type: "index", table, sql: null });
  const rows = db
    .prepare(`SELECT name, type, tbl_name,
    CASE WHEN octet_length(sql) <= 4096 OR sql IS NULL THEN sql ELSE '' END AS sql
    FROM main.sqlite_schema LIMIT ?`)
    .iterate(expected.size + 1);
  for (const { name, type, tbl_name, sql } of rows) {
    if (typeof name !== "string") throw invalid();
    const row = expected.get(name);
    if (!row || row.type !== type || row.table !== tbl_name || row.sql !== sql) throw invalid();
    expected.delete(name);
  }
  if (expected.size !== 0) throw invalid();
}

function checkJournal(path: string) {
  if (
    lstatSync(path + "-wal", { throwIfNoEntry: false }) ||
    lstatSync(path + "-shm", { throwIfNoEntry: false })
  )
    throw invalid();
  const journal = path + "-journal";
  if (!lstatSync(journal, { throwIfNoEntry: false })) return false;
  const fd = openSync(journal, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > fileLimit) throw invalid();
    // SQLite recognizes cross-database rollback references by their trailing magic.
    // Easy Proto uses one database, so reject these before SQLite can recover it.
    if (stat.size >= journalMagic.length) {
      const tail = Buffer.alloc(journalMagic.length);
      if (
        readSync(fd, tail, 0, tail.length, stat.size - tail.length) !== tail.length ||
        tail.equals(journalMagic)
      )
        throw invalid();
    }
    return true;
  } finally {
    closeSync(fd);
  }
}

function openExisting(path: string, expected: SqliteIdentity, writing = false) {
  const file = lstatSync(path, { bigint: true });
  if (
    !file.isFile() ||
    file.nlink !== 1n ||
    file.size > BigInt(fileLimit) ||
    file.dev !== expected.dev ||
    file.ino !== expected.ino
  )
    throw invalid();
  const recovery = checkJournal(path);
  const db = new DatabaseSync(path, { allowExtension: false, readOnly: !writing && !recovery });
  try {
    db.exec("PRAGMA trusted_schema = OFF; PRAGMA synchronous = FULL");
    verifyFormat(db);
    if (writing || recovery) {
      const pageSize = Number(db.prepare("PRAGMA page_size").get()?.page_size);
      const maxPages = Math.floor(fileLimit / pageSize);
      if (db.prepare(`PRAGMA max_page_count = ${maxPages}`).get()?.max_page_count !== maxPages)
        throw invalid();
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function verifyMetadataSize(db: DatabaseSync) {
  const totals = db
    .prepare(`SELECT
    coalesce((SELECT sum(octet_length(metadata)) FROM project), 0) +
    coalesce((SELECT sum(octet_length(metadata)) FROM board), 0) +
    coalesce((SELECT sum(octet_length(result) + octet_length(digest)) FROM receipt), 0) AS bytes`)
    .get();
  if (Number(totals?.bytes) > metadataLimit) throw new Error("Project history capacity reached.");
}

function verifyPayload(db: DatabaseSync) {
  const invalidRows = db
    .prepare(`SELECT 1 WHERE
    (SELECT count(*) FROM board) > ? OR
    (SELECT count(*) FROM source) > ? OR
    EXISTS (SELECT 1 FROM source WHERE octet_length(digest) != 64 OR octet_length(body) > ?) OR
    EXISTS (SELECT 1 FROM project WHERE octet_length(name) > 4096 OR
      octet_length(token_document) > ? OR octet_length(token_css) > ?) OR
    (SELECT count(*) FROM asset) > 2048 OR
    EXISTS (SELECT 1 FROM asset WHERE octet_length(bytes) > ? OR
      octet_length(path) > 4096 OR octet_length(mime) > 64) OR
    (SELECT total(octet_length(bytes)) FROM asset) > ? OR
    EXISTS (SELECT 1 FROM board WHERE octet_length(id) != 36 OR
      octet_length(html_digest) != 64 OR octet_length(css_digest) != 64) OR
    EXISTS (SELECT 1 FROM receipt WHERE octet_length(id) != 36 OR octet_length(digest) != 64)
  `)
    .get(
      artboardLimit,
      artboardLimit * 2,
      mebibyte,
      tokenByteLimit,
      tokenByteLimit,
      8 * mebibyte,
      32 * mebibyte,
    );
  if (invalidRows) throw invalid();
  verifyMetadataSize(db);
}

function verifyWriteCapacity(db: DatabaseSync) {
  verifyMetadataSize(db);
  const capacity = db
    .prepare("SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()")
    .get();
  if (Number(capacity?.bytes) > fileLimit) throw new Error("Project storage capacity reached.");
}

function inTransaction(db: DatabaseSync, write: () => void) {
  db.exec("BEGIN IMMEDIATE");
  try {
    write();
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function writeSnapshot(db: DatabaseSync, next: Snapshot, previous?: Snapshot) {
  const { artboards, commands, ...metadata } = next.manifest;
  db.prepare("UPDATE project SET metadata = ?, token_document = ?, token_css = ? WHERE id = 1").run(
    JSON.stringify(metadata),
    next.tokens?.document ?? null,
    next.tokens?.css ?? null,
  );
  const savedSources = db.prepare(
    "INSERT INTO source VALUES (?, ?) ON CONFLICT(digest) DO NOTHING",
  );
  const savedBoard = db.prepare(`INSERT INTO board VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET position = excluded.position, metadata = excluded.metadata,
    html_digest = excluded.html_digest, css_digest = excluded.css_digest`);
  const previousBoards = new Map(
    previous?.manifest.artboards.map((board, position) => [board.id, { board, position }]),
  );
  const current = new Set(artboards.map(({ id }) => id));
  const remove = db.prepare("DELETE FROM board WHERE id = ?");
  for (const id of previousBoards.keys()) {
    if (!current.has(id)) remove.run(id);
  }
  for (const [position, board] of artboards.entries()) {
    const old = previousBoards.get(board.id);
    if (old?.position === position && JSON.stringify(old.board) === JSON.stringify(board)) continue;
    const content = next.sources.get(board.id)!;
    const html = sourceDigest(content.html);
    const css = sourceDigest(content.css);
    savedSources.run(html, content.html);
    savedSources.run(css, content.css);
    savedBoard.run(board.id, position, JSON.stringify(board), html, css);
  }
  db.exec(
    "DELETE FROM source WHERE digest NOT IN (SELECT html_digest FROM board UNION SELECT css_digest FROM board)",
  );
  const append = db.prepare("INSERT INTO receipt VALUES (?, ?, ?, ?)");
  for (
    let position = previous?.manifest.commands.length ?? 0;
    position < commands.length;
    position++
  ) {
    const { digest, result } = commands[position];
    append.run(position, result.commandId, digest, JSON.stringify(result));
  }
}

export function readSqliteProject(path: string, identity: SqliteIdentity): SqliteSnapshot {
  const db = openExisting(path, identity);
  try {
    db.exec("BEGIN");
    verifyPayload(db);
    if (
      db.prepare("PRAGMA integrity_check(1)").get()?.integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").get()
    )
      throw invalid();
    const record = projectRow(db);
    const bodies = new Map<string, string>();
    for (const { digest, body } of db.prepare("SELECT digest, body FROM source").iterate()) {
      if (typeof body !== "string" || sourceDigest(body) !== digest) throw invalid();
      bodies.set(digest, body);
    }
    const boards = db.prepare("SELECT * FROM board ORDER BY position").all();
    const receipts = db
      .prepare("SELECT position, id, digest, result FROM receipt ORDER BY position")
      .all();
    const manifest = manifestSchema.parse({
      ...record.metadata,
      artboards: boards.map(({ metadata }) => JSON.parse(String(metadata))),
      commands: receipts.map(({ digest, result }) => ({
        digest,
        result: JSON.parse(String(result)),
      })),
    });
    const sources = new Map<string, Source>();
    for (const { id, html_digest, css_digest } of boards) {
      const html = bodies.get(String(html_digest));
      const css = bodies.get(String(css_digest));
      if (html === undefined || css === undefined) throw invalid();
      sources.set(String(id), { html, css });
    }
    if (
      boards.some(({ position, id }, i) => position !== i || id !== manifest.artboards[i].id) ||
      receipts.some(
        ({ position, id }, i) => position !== i || id !== manifest.commands[i].result.commandId,
      )
    )
      throw invalid();
    const assets = new Map<string, Asset>();
    for (const { position, path, mime, bytes } of db
      .prepare("SELECT position, path, mime, bytes FROM asset ORDER BY position")
      .iterate()) {
      if (
        position !== assets.size ||
        typeof path !== "string" ||
        typeof mime !== "string" ||
        !(bytes instanceof Uint8Array)
      )
        throw invalid();
      assets.set(path, { mime, bytes: Buffer.from(bytes) });
    }
    const document = record.tokenDocument;
    const css = record.tokenCss;
    if (
      typeof document !== typeof css ||
      Boolean(manifest.tokens) !== (typeof document === "string")
    )
      throw invalid();
    const tokens =
      typeof document === "string" && typeof css === "string" ? { document, css } : undefined;
    db.exec("COMMIT");
    return {
      identity: { dev: identity.dev, ino: identity.ino },
      name: record.name,
      manifest,
      sources,
      tokens,
      assets,
    };
  } finally {
    db.close();
  }
}

export async function writeSqliteProjectCopy(
  path: string,
  project: { name: string; snapshot: Snapshot; assets: ReadonlyMap<string, Asset> },
  checkDestination?: (parent: string) => void,
) {
  if (extname(path) !== ".easyproto") throw new Error("Use a destination ending in .easyproto.");
  const target = resolve(path);
  const parent = await realpath(dirname(target));
  const final = join(parent, basename(target));
  function checkAvailable() {
    checkDestination?.(parent);
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      if (lstatSync(final + suffix, { throwIfNoEntry: false }))
        throw Object.assign(new Error("The destination or a recovery file already exists."), {
          code: "EEXIST",
        });
    }
  }
  checkAvailable();
  const staging = await mkdtemp(join(parent, ".easyproto-copy-"));
  const pending = join(staging, "project");
  try {
    const file = await open(pending, "wx", 0o600);
    await file.close();
    const db = new DatabaseSync(pending, { allowExtension: false });
    try {
      db.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL");
      inTransaction(db, () => {
        db.exec(
          `PRAGMA application_id = ${applicationId}; PRAGMA user_version = ${containerVersion}`,
        );
        for (const table of Object.values(tables)) db.exec(table);
        db.prepare("INSERT INTO project (id, name, metadata) VALUES (1, ?, '{}')").run(
          project.name,
        );
        writeSnapshot(db, project.snapshot);
        const insert = db.prepare("INSERT INTO asset VALUES (?, ?, ?, ?)");
        let position = 0;
        for (const [path, { bytes, mime }] of project.assets)
          insert.run(position++, path, mime, bytes);
        verifyPayload(db);
        verifyWriteCapacity(db);
      });
      if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw invalid();
    } finally {
      db.close();
    }
    checkAvailable();
    await link(pending, final);
    await unlink(pending);
    return final;
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function saveSqliteProject(
  path: string,
  identity: SqliteIdentity,
  previous: Snapshot,
  next: Snapshot,
  beforeCommit?: () => void,
) {
  const db = openExisting(path, identity, true);
  try {
    inTransaction(db, () => {
      const { metadata } = projectRow(db);
      if (
        metadata.projectId !== previous.manifest.projectId ||
        metadata.revision !== previous.manifest.revision
      )
        throw new Error("The database revision changed.");
      writeSnapshot(db, next, previous);
      verifyWriteCapacity(db);
      beforeCommit?.();
    });
  } finally {
    db.close();
  }
}

export function renameSqliteProject(
  path: string,
  identity: SqliteIdentity,
  projectId: string,
  previous: string,
  next: string,
) {
  const db = openExisting(path, identity, true);
  try {
    inTransaction(db, () => {
      const { metadata, name } = projectRow(db);
      if (metadata.projectId !== projectId || name !== previous)
        throw new Error("The project changed.");
      db.prepare("UPDATE project SET name = ? WHERE id = 1").run(next);
      verifyWriteCapacity(db);
    });
  } finally {
    db.close();
  }
}
