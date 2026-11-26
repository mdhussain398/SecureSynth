/* Human-readable audit events shared by the incident, session and investigation views. Raw event types stay in the API and exports. */
import { formatPaise } from '../../design/components';

export const sentence = (v: string) => { const t = v.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

export const AUDIT_LABEL: Record<string, string> = {
  'incident.opened': 'Incident opened', 'incident.updated': 'Another restriction attached', 'incident.reviewed': 'Opened by an analyst',
  'ghost.entered': 'Contained in Ghost Banking', 'incident.request_verification': 'Identity verification requested',
  'incident.verification_approved': 'Trusted device approved the check', 'incident.verification_denied': 'Trusted device declined the check',
  'incident.verification_expired': 'Verification request expired', 'incident.unblock_session': 'Session unblocked', 'incident.clear_user': 'Customer cleared for recovery',
  'incident.keep_restricted': 'Restriction kept', 'incident.revoke_session': 'Session revoked', 'incident.photo_requested': 'Verification photo requested',
  'incident.photo_submitted': 'Verification photo received', 'incident.photo_declined': 'Verification photo declined', 'incident.note_added': 'Note added',
  'incident.reauth_failed': 'Re-authentication failed', 'report.prepared': 'Cybercrime report prepared',
  'ghost.transfer_simulated': 'Synthetic transfer simulated', 'ghost.beneficiary_added': 'Synthetic payee added', 'ghost.compare_viewed': 'Ghost comparison viewed',
  'ghost.session_restricted_on_disable': 'Restricted when Ghost Banking was turned off', 'evidence.integrity_alert': 'Evidence integrity alert',
  'evidence.accessed': 'Evidence viewed', 'evidence.deleted': 'Evidence deleted', 'summary.approved': 'Summary approved',
  'auth.login': 'Signed in', 'auth.logout': 'Signed out', 'challenge.created': 'Trusted-device check sent', 'challenge.approved': 'Trusted device approved',
  'challenge.denied': 'Trusted device declined', 'session.restricted': 'Session restricted', 'session.revoked': 'Session revoked',
  'transfer.completed': 'Transfer completed', 'transfer.restricted': 'Transfer stopped', 'transfer.failed_funds': 'Transfer failed: insufficient funds',
  'beneficiary.added': 'Payee added', 'beneficiary.restricted': 'Payee addition stopped', 'config.ghost_banking': 'Ghost Banking setting changed',
  'lab.scenario_run': 'Lab scenario run', 'lab.reset': 'Lab data reset',
  'report.final_confirmation': 'Report confirmed for submission', 'report.exported': 'Report exported', 'report.official_ack': 'Official acknowledgement recorded',
};
const AUDIT_KEY: Record<string, string> = { trigger: 'Trigger', severity: 'Severity', risk_score: 'Risk', status: 'Status', reason: 'Reason', action: 'Action',
  previous_state: 'From', resulting_state: 'To', amount_paise: 'Amount', protected_balance_paise: 'Protected balance', ghost_account_ref: 'Synthetic account', reviewed_attempts: 'Attempts reviewed',
  decision: 'Decision', city: 'City', mode: 'Mode', operation: 'Operation', device_recognised: 'Recognised device', counterparty: 'Payee', name: 'Payee' };
export function auditDetail(details: Record<string, unknown>): string {
  return Object.entries(details).filter(([k, v]) => k in AUDIT_KEY && v != null && v !== '').map(([k, v]) => {
    const val = typeof v === 'boolean' ? (v ? 'yes' : 'no') : k === 'decision' ? String(v).replace('STEP_UP', 'step-up').toLowerCase() : k.endsWith('_paise') ? formatPaise(Number(v), true) : k === 'risk_score' ? Number(v).toFixed(1) : v === 'dummy' ? 'demo' : String(v).replace(/_/g, ' ');
    return `${AUDIT_KEY[k]}: ${val}`;
  }).join(' · ');
}

