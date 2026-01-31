import { trace } from "autotel";

interface ButtonProps {
  label: string;
  onClick: () => void;
}

const Button = trace('Button', function Button({ label, onClick }: ButtonProps) {
  return <button onClick={onClick}>{label}</button>;
};
