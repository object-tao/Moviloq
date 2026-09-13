import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useLanguage } from "../lib/i18n";
import { ArrowIcon, CloseIcon, MenuIcon } from "./Icons";
import { Logo } from "./Logo";

export function Layout({ children }: { children: ReactNode }) {
  const { language, setLanguage, t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [location.pathname]);

  const navItems = [
    ["/personal", t.nav.personal],
    ["/business", t.nav.business],
    ["/partners", t.nav.partner],
    ["/track", t.nav.track]
  ];

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="container header-inner">
          <Logo />
          <nav className={`main-nav ${menuOpen ? "main-nav--open" : ""}`} aria-label="Main navigation">
            {navItems.map(([path, label]) => (
              <NavLink key={path} to={path} className={({ isActive }) => isActive ? "active" : ""}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <div className="language-toggle" aria-label="Language">
              <button className={language === "en" ? "selected" : ""} onClick={() => setLanguage("en")}>EN</button>
              <span>/</span>
              <button className={language === "zh" ? "selected" : ""} onClick={() => setLanguage("zh")}>中文</button>
            </div>
            <Link to="/login" className="text-link header-login">{t.nav.login}</Link>
            <Link to="/book" className="button button--small">
              {t.nav.book}<ArrowIcon size={16} />
            </Link>
            <button className="menu-button" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle navigation">
              {menuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            <Logo inverse />
            <p className="footer-intro">Local logistics, coordinated with clarity.</p>
            <span className="pilot-chip">{t.common.beta}</span>
          </div>
          <div>
            <h3>Moviloq</h3>
            <Link to="/personal">{t.nav.personal}</Link>
            <Link to="/business">{t.nav.business}</Link>
            <Link to="/partners">{t.nav.partner}</Link>
          </div>
          <div>
            <h3>Support</h3>
            <Link to="/track">{t.nav.track}</Link>
            <Link to="/help">Help centre</Link>
            <a href="mailto:hello@moviloq.com">hello@moviloq.com</a>
          </div>
          <div>
            <h3>Legal</h3>
            <Link to="/legal/privacy">Privacy</Link>
            <Link to="/legal/terms">Terms</Link>
            <Link to="/legal/imprint">Imprint</Link>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>© {new Date().getFullYear()} Moviloq</span>
          <span>Frankfurt am Main, Germany</span>
        </div>
      </footer>
    </div>
  );
}
