import type { MicrocksStatus as Status } from '../lib/microcks/client';

interface Props {
  status?: Status;
  liveError?: string;
  services: number;
  onRefresh: () => void;
}

export function MicrocksStatus({ status, liveError, services, onRefresh }: Props) {
  const problem = !status ? undefined : !status.reachable ? status.error : status.authMissing ? 'Authentication is enabled but no client credentials are configured.' : liveError;
  const state = !status ? 'unknown' : !status.reachable || problem ? 'down' : 'up';

  return (
    <div className={`status status-${state}`} role="status">
      <div>
        <span className="dot" aria-hidden="true" />
        <strong>Microcks</strong> <code>{status?.url ?? '…'}</code>
      </div>
      {status?.reachable && (
        <div className="muted">
          {status.version && `v${status.version} · `}
          {status.authEnabled ? 'Keycloak' : 'no auth'} · {services} service{services === 1 ? '' : 's'}
        </div>
      )}
      {problem && <div className="error">{problem}</div>}
      <button type="button" className="secondary small" onClick={onRefresh}>
        Refresh
      </button>
    </div>
  );
}
