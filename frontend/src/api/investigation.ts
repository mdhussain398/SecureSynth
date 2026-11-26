/* SecureSynth 3.0 investigation API: types and hooks. Every call hits a real backend endpoint. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, request } from './client';
import type { AuditEvent, RiskAssessment } from './types';

export type Classification = 'observed' | 'derived' | 'synthetic';
export interface EvidenceItem {
  id: string; incident_ref: string | null; session_id: string | null; kind: string; classification: Classification;
  source: string; provenance: string; content: Record<string, unknown> | null; has_file: boolean; mime: string | null;
  size_bytes: number | null; sha256: string; collected_at: string; collected_by: string; retention_until: string;
  is_lab: boolean; deleted_at: string | null; meta: Record<string, unknown>;
}
export interface PhotoRequestRow { id: string; session_id: string; status: string; requested_by: string; reason: string; created_at: string; expires_at: string; responded_at: string | null; consent: boolean | null; evidence_id: string | null }
export interface EvidenceResponse {
  incident_ref: string; items: EvidenceItem[]; manifest: { manifest_sha256: string; items: { evidence_id: string; kind: string; classification: string; sha256: string }[] };
  photo_requests: PhotoRequestRow[]; alerts: { id: number; ts: string; problem: string; detail: string; evidence_id: string | null }[];
}
export interface VerifyResult {
  status: 'verified' | 'mismatch' | 'missing'; checked_at: string; chains: Record<string, string>;
  items: { evidence_id: string; kind?: string; status: string; detail: string }[]; problems: { problem: string; detail: string }[];
}
export interface CustodyEvent { seq: number; chain: string; ts: string; event_type: string; actor: string; evidence_id: string | null; content_hash: string | null; prev_hash: string; entry_hash: string; meta: Record<string, unknown> }
export interface TimelineEvent { ts: string; source: string; kind: string; title: string; detail?: string; actor?: string; synthetic: boolean; ref?: string }
export interface GraphNode { id: string; type: 'incident' | 'customer' | 'session' | 'ip' | 'device' | 'beneficiary' | 'transaction'; label: string; incidents: string[]; first_seen: string | null; last_seen: string | null; synthetic: boolean; degree: number; [k: string]: unknown }
export interface GraphEdge { source: string; target: string; relation: string; kind: 'direct' | 'derived'; strength: 'weak' | 'moderate' | 'strong' | null; provenance: string; synthetic: boolean; explanation: string; limitations?: string; indicators?: { rule: string; indicator: string; level: string; value: string; note: string }[] }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean; masked: boolean; caveat: string; rules: Record<string, string>; limits: { incidents: number; nodes: number }; generated_at: string }
export interface Metric { value: number | null; median?: number | null; n: number; unit: string; note?: string }
export interface SocMetrics {
  range: { key: string; since: string; until: string; step_s: number }; include_lab: boolean;
  kpis: Record<string, number>; definitions: Record<string, string>; performance: Record<string, Metric>;
  series: { t: string; ALLOW: number; STEP_UP: number; BLOCK: number; incidents: number; ghost: number; restricted: number; prevented_paise: number; resolved: number; ghost_events: number }[];
  severity: Record<string, number>; decisions: Record<string, number>; report_status: Record<string, number>;
  feed: { ts: string; kind: string; title: string; detail: string; incident_id: number | null; lab: boolean; severity: string }[]; generated_at: string;
}
export interface SummarySection { key: string; title: string; kind: 'fact' | 'interpretation' | 'recommendation'; text: string; refs: string[] }
export interface Summary { id: number; incident_ref: string; version: number; method: string; generated_by: string; evidence_version: string; stale: boolean; sections: SummarySection[]; edited: boolean; status: 'draft' | 'approved'; created_by: string; created_at: string; approved_by: string | null; approved_at: string | null; is_lab: boolean; missing_evidence: string[]; note?: string | null }
export interface SummaryState { latest: Summary | null; versions: number; llm: { available: boolean; detail: string }; missing_evidence: string[] }
export interface ReportFields {
  complaint: Record<string, string>; affected_customer: Record<string, string | null>; complainant: Record<string, string>;
  description: string; financial: Record<string, string | string[] | null>; digital_evidence: Record<string, string | string[] | null>;
  disclosure: { include_customer_name: boolean; include_ip: boolean; include_photo: boolean }; is_lab: boolean;
}
export interface Report {
  id: string; incident_ref: string; incident_id?: number | null; destination: 'dummy' | 'official'; status: string; status_label: string; version: number;
  fields: ReportFields; disclosed_fields: ReportFields | null; attachments: { id: string; kind: string | null; classification: string | null; sha256: string | null; missing: boolean }[];
  manifest_hash: string; manifest_matches: boolean; summary_id: number | null; created_by: string; created_at: string; updated_at: string;
  approved_by: string | null; approved_at: string | null; submitted_at: string | null; ack_number: string | null; ack_evidence_id: string | null;
  is_lab: boolean; history: { at: string; event: string; by: string; detail: string }[]; missing_fields: string[]; phrase: string; checklist: string[];
  warning: string; portal: string | null; helpline: string; confirmations: { id: string; stage: string; version: number; destination: string; analyst: string; expires_at: string; consumed: boolean; valid: boolean }[];
  demo_complaint?: { ack: string; status: string; updated_at: string } | null;
}
export interface ReportRow { id: string; incident_ref: string; destination: string; status: string; status_label: string; version: number; created_by: string; created_at: string; approved_at: string | null; submitted_at: string | null; ack_number: string | null; is_lab: boolean; manifest_matches: boolean; attachments: number; responsible: string }
export interface GhostConfig {
  runtime: 'on' | 'off'; effective: boolean; version: number; gate_enabled: boolean; can_enable: boolean; approval_status: string; approval_ref: string | null;
  demo_mode: boolean; last_change: { by: string; at: string; reason: string; from: string; to: string; effect: Record<string, number> } | null;
  active_ghost_sessions: number; total_contained_sessions: number; policy: string; history: { at: string; by: string; from: string; to: string; reason: string; effect: Record<string, number> }[];
}

export const iq = {
  evidence: (id: number) => ['admin', 'inv', 'evidence', id] as const,
  timeline: (id: number) => ['admin', 'inv', 'timeline', id] as const,
  custody: (id: number) => ['admin', 'inv', 'custody', id] as const,
  summary: (id: number) => ['admin', 'inv', 'summary', id] as const,
  graph: (p: string) => ['admin', 'intel', p] as const,
  soc: (p: string) => ['admin', 'soc', p] as const,
  reports: (p: string) => ['admin', 'reports', p] as const,
  report: (id: string) => ['admin', 'report', id] as const,
  ghostConfig: ['admin', 'ghost-config'] as const,
};

export const useEvidence = (id: number) => useQuery({ queryKey: iq.evidence(id), queryFn: () => api.get<EvidenceResponse>(`/admin/incidents/${id}/evidence`) });
export const useTimeline = (id: number) => useQuery({ queryKey: iq.timeline(id), queryFn: () => api.get<{ events: TimelineEvent[] }>(`/admin/incidents/${id}/timeline`), refetchInterval: 5000 });
export const useCustody = (id: number, enabled: boolean) => useQuery({ queryKey: iq.custody(id), queryFn: () => api.get<{ events: CustodyEvent[] }>(`/admin/incidents/${id}/custody`), enabled });
export const useSummary = (id: number) => useQuery({ queryKey: iq.summary(id), queryFn: () => api.get<SummaryState>(`/admin/incidents/${id}/summary`) });
export const useGraph = (params: string) => useQuery({ queryKey: iq.graph(params), queryFn: () => api.get<Graph>(`/admin/intel/graph?${params}`), refetchInterval: params.includes('reveal=true') ? false : 15000 });
export const useSoc = (params: string) => useQuery({ queryKey: iq.soc(params), queryFn: () => api.get<SocMetrics>(`/admin/soc/metrics?${params}`), refetchInterval: 8000 });
export const useReports = (params: string) => useQuery({ queryKey: iq.reports(params), queryFn: () => api.get<ReportRow[]>(`/admin/reports?${params}`), refetchInterval: 8000 });
export const useReport = (id: string | null) => useQuery({ queryKey: iq.report(id ?? ''), queryFn: () => api.get<Report>(`/admin/reports/${id}`), enabled: !!id });
export const useGhostConfig = () => useQuery({ queryKey: iq.ghostConfig, queryFn: () => api.get<GhostConfig>('/admin/ghost-config'), refetchInterval: 8000 });

/** One generic mutation hook: POST/PUT to a real endpoint and refresh the admin caches it touches. */
export function useAct<TBody, TOut>(method: 'POST' | 'PUT', path: string | ((b: TBody) => string), invalidate: readonly unknown[][] = [['admin']]) {
  const qc = useQueryClient();
  return useMutation<TOut, ApiError, TBody>({
    mutationFn: async (b) => {
      const p = typeof path === 'function' ? path(b) : path;
      return (await request<TOut>(method, p, { body: b })).data;
    },
    onSettled: () => { invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k })); },
  });
}

/** Authenticated download (session cookie) of a protected file; every download is recorded server-side. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  if (!res.ok) {
    let msg = `Download failed (${res.status}).`;
    try { msg = (await res.json()).error?.message ?? msg; } catch { /* not JSON */ }
    throw new ApiError('UNKNOWN', msg, res.status);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Fetch a protected image as an object URL for an in-page preview (audited as an access). */
export async function protectedObjectUrl(path: string): Promise<string> {
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  if (!res.ok) throw new ApiError('UNKNOWN', `Could not load (${res.status}).`, res.status);
  return URL.createObjectURL(await res.blob());
}

export type { AuditEvent, RiskAssessment };
