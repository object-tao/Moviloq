import { useState } from "react";
import { useSettings } from "../lib/settings";
import { Link } from "react-router-dom";

export function Logo({ inverse = false }: { inverse?: boolean }) {
  const {site}=useSettings();
  const [failedUrl,setFailedUrl]=useState("");
  return (
    <Link to="/" className={`logo ${inverse ? "logo--inverse" : ""}`} aria-label={`${site.name} home`}>
      {site.logoUrl && failedUrl!==site.logoUrl ? <img className="logo__image" src={site.logoUrl} alt="" referrerPolicy="no-referrer" onError={()=>setFailedUrl(site.logoUrl)} /> : <span className="logo__mark" aria-hidden="true">
        <span>M</span>
      </span>}
      <span className="logo__word">{site.name}</span>
    </Link>
  );
}
