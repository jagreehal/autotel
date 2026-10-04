import { useToolInfo } from '../helpers.js';

function Flights() {
  const { output } = useToolInfo<'search-flights'>();
  if (!output) return <p>Searching…</p>;
  return (
    <ul>
      {output.flights.map((f) => (
        <li key={f.id}>
          {f.id} {f.from} → {f.to} £{f.price}
        </li>
      ))}
    </ul>
  );
}

export default Flights;
