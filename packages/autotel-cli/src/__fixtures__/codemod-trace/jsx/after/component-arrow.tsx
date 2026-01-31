import { trace } from "autotel";

interface ButtonProps {
  label: string;
  onClick: () => void;
}

const Button = trace('Button', ({ label, onClick }: ButtonProps) => {
  return <button onClick={onClick}>{label}</button>;
});
