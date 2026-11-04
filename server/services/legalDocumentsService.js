const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../database');
const { listLegalDocumentsMeta, getLegalDocument } = require('../data/legalDocumentsCatalog');

let schemaReady = false;

function ensureLegalDocumentsSchema() {
  if (schemaReady) return;
  runSql(`
    CREATE TABLE IF NOT EXISTS legal_document_acceptances (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      document_version TEXT NOT NULL,
      document_title TEXT DEFAULT '',
      user_id TEXT NOT NULL,
      user_name TEXT DEFAULT '',
      user_role TEXT DEFAULT '',
      accepted_at TEXT NOT NULL,
      ip_address TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  runSql(
    'CREATE INDEX IF NOT EXISTS idx_legal_accept_doc ON legal_document_acceptances(document_id, document_version)',
  );
  runSql(
    'CREATE INDEX IF NOT EXISTS idx_legal_accept_user ON legal_document_acceptances(user_id, accepted_at)',
  );
  schemaReady = true;
}

function clientIp(req) {
  const xf = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req?.ip || req?.socket?.remoteAddress || '').trim();
}

function latestAcceptanceFor(documentId, userId) {
  ensureLegalDocumentsSchema();
  return queryOne(
    `SELECT * FROM legal_document_acceptances
     WHERE document_id = ? AND user_id = ?
     ORDER BY accepted_at DESC LIMIT 1`,
    [documentId, userId],
  );
}

function catalogWithStatus(userId) {
  ensureLegalDocumentsSchema();
  const uid = String(userId || '').trim();
  return listLegalDocumentsMeta().map((doc) => {
    const last = uid ? latestAcceptanceFor(doc.id, uid) : null;
    const acceptedCurrent = Boolean(
      last && String(last.document_version) === String(doc.version),
    );
    return {
      ...doc,
      accepted_current: acceptedCurrent,
      pending_acceptance: !acceptedCurrent,
      last_acceptance: last
        ? {
            id: last.id,
            document_version: last.document_version,
            user_id: last.user_id,
            user_name: last.user_name,
            user_role: last.user_role,
            accepted_at: last.accepted_at,
          }
        : null,
    };
  });
}

function pendingForUser(userId) {
  return catalogWithStatus(userId).filter((d) => d.pending_acceptance);
}

function documentDetail(id, userId) {
  const doc = getLegalDocument(id);
  if (!doc) return null;
  const status = catalogWithStatus(userId).find((d) => d.id === doc.id);
  return {
    ...doc,
    accepted_current: status?.accepted_current || false,
    pending_acceptance: status?.pending_acceptance !== false,
    last_acceptance: status?.last_acceptance || null,
  };
}

function acceptDocument(documentId, user, req) {
  ensureLegalDocumentsSchema();
  const doc = getLegalDocument(documentId);
  if (!doc) {
    const err = new Error('Documento no encontrado');
    err.status = 404;
    throw err;
  }
  const uid = String(user?.id || '').trim();
  if (!uid) {
    const err = new Error('Usuario no autenticado');
    err.status = 401;
    throw err;
  }
  const existing = latestAcceptanceFor(doc.id, uid);
  if (existing && String(existing.document_version) === String(doc.version)) {
    return {
      already_accepted: true,
      acceptance: existing,
      document: {
        id: doc.id,
        title: doc.title,
        version: doc.version,
        updated_at: doc.updated_at,
      },
    };
  }
  const id = uuidv4();
  const acceptedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const userName = String(user.full_name || user.username || '').trim();
  const userRole = String(user.role || '').trim();
  runSql(
    `INSERT INTO legal_document_acceptances
      (id, document_id, document_version, document_title, user_id, user_name, user_role, accepted_at, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      doc.id,
      doc.version,
      doc.title,
      uid,
      userName,
      userRole,
      acceptedAt,
      clientIp(req),
    ],
  );
  const acceptance = queryOne('SELECT * FROM legal_document_acceptances WHERE id = ?', [id]);
  return {
    already_accepted: false,
    acceptance,
    document: {
      id: doc.id,
      title: doc.title,
      version: doc.version,
      updated_at: doc.updated_at,
    },
  };
}

function listAcceptances({ documentId = '', limit = 200 } = {}) {
  ensureLegalDocumentsSchema();
  const lim = Math.min(500, Math.max(1, Number(limit) || 200));
  const docId = String(documentId || '').trim();
  if (docId) {
    return queryAll(
      `SELECT * FROM legal_document_acceptances
       WHERE document_id = ?
       ORDER BY accepted_at DESC
       LIMIT ?`,
      [docId, lim],
    );
  }
  return queryAll(
    `SELECT * FROM legal_document_acceptances
     ORDER BY accepted_at DESC
     LIMIT ?`,
    [lim],
  );
}

function versionsOverview() {
  return listLegalDocumentsMeta().map((d) => ({
    id: d.id,
    title: d.title,
    version: d.version,
    updated_at: d.updated_at,
    summary: d.summary,
  }));
}

module.exports = {
  ensureLegalDocumentsSchema,
  catalogWithStatus,
  pendingForUser,
  documentDetail,
  acceptDocument,
  listAcceptances,
  versionsOverview,
};
