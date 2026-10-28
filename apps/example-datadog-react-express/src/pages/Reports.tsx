import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export function Reports() {
  const report = useQuery({
    queryKey: ['reports'],
    queryFn: async () => (await api.get('/reports')).data,
  });
  if (report.isPending) return <p>Loading report…</p>;
  if (report.isError) {
    return (
      <p role="alert" id="report-error">
        {report.error.message}
      </p>
    );
  }
  return <pre>{JSON.stringify(report.data)}</pre>;
}
