import { trace } from "autotel";

const Button = trace('Button', function Button({ label, onClick }) {
  return <button onClick={onClick}>{label}</button>;
};
