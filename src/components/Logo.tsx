import { Link } from "react-router-dom";

export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link to="/" className={`logo ${inverse ? "logo--inverse" : ""}`} aria-label="Moviloq home">
      <span className="logo__mark" aria-hidden="true">
        <span>M</span>
      </span>
      <span className="logo__word">moviloq</span>
    </Link>
  );
}
