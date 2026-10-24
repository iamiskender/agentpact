import { JobStatus, STATUS_COLORS } from '@/contract';

interface Props {
  status: JobStatus;
}

export function StatusBadge({ status }: Props) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${STATUS_COLORS[status]}`}
      style={{ letterSpacing: '0.06em' }}
    >
      {status}
    </span>
  );
}
