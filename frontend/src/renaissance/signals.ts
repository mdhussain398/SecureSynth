/* Behavioural signals for the identity orb, derived only from a backend RiskAssessment. */
import type { RiskAssessment } from '../api/types';
import type { OrbSignal, SignalLevel } from './orb/types';

export const SIGNAL_LABEL: Record<string, string> = {
  device_recognised: 'Browser', hour_rarity: 'Time of day', city_known: 'Location', log_km_from_home: 'Distance from home',
  travel_speed_kmh: 'Travel speed', amount_robust_z: 'Amount', txn_velocity_ratio: 'Transfer frequency',
  beneficiary_new: 'New payee', beneficiary_fresh: 'Payee just added', log_secs_login_to_sensitive: 'Speed to act',
  sensitive_seq: 'Add-then-pay', failed_auth_24h: 'Failed sign-ins', travel_window_active: 'Travel window',
};
const SEV: Record<string, SignalLevel> = { low: 1, medium: 2, high: 3 };

export function signalsOf(a: RiskAssessment | undefined): OrbSignal[] {
  if (!a) return [];
  const dev = new Map(a.deviations.map((d) => [d.feature, SEV[d.severity] ?? 1]));
  return Object.keys(SIGNAL_LABEL).filter((k) => k in a.features)
    .map((k) => ({ id: k, label: SIGNAL_LABEL[k], level: (dev.get(k) ?? 0) as SignalLevel }));
}

