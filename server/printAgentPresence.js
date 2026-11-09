/** Presencia del asistente Android (poll a print-jobs / billing pending-local). */

const ONLINE_MS = 90_000;

let lastSeenAt = null;
let lastUserId = null;
let lastRole = null;
let lastSource = null;

function touchPrintAgent(req, source = 'poll') {
  lastSeenAt = new Date().toISOString();
  lastUserId = req?.user?.id != null ? String(req.user.id) : null;
  lastRole = req?.user?.role != null ? String(req.user.role) : null;
  lastSource = String(source || 'poll');
}

function getPrintAgentPresence() {
  const at = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  const online = Number.isFinite(at) && Date.now() - at < ONLINE_MS;
  return {
    cloudQueue: true,
    agentOnline: online,
    agentSeenAt: lastSeenAt,
    agentUserId: lastUserId,
    agentRole: lastRole,
    agentSource: lastSource,
    onlineWindowMs: ONLINE_MS,
  };
}

module.exports = {
  touchPrintAgent,
  getPrintAgentPresence,
};
