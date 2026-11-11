"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";

/** ALU-style navy top bar: logo, uppercase links with red underline, red block on the right. */
export default function TopNav({ title = "Learning session", links = [], right = null, mobileExtra = null }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href) => (href === "/admin" ? path === "/admin" : path.startsWith(href));
  return (
    <>
      <header className="topnav">
        <div className="inner">
          <a className="logo" href={links[0]?.href || "/"}>
            <span className="mark">PI<span>L</span>OT</span>
            <span className="words">{title.split(" ").map((w, i) => <span key={i} style={{ display: "block" }}>{w}</span>)}</span>
          </a>
          {links.length > 0 && (
            <nav className="navlinks">
              {links.map((l) => <a key={l.href} href={l.href} className={isActive(l.href) ? "active" : ""}>{l.label}</a>)}
            </nav>
          )}
          {(links.length > 0 || mobileExtra) && (
            <button className="hamburger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button>
          )}
        </div>
        {right}
      </header>
      {open && (
        <div className="mobile-menu">
          {links.map((l) => <a key={l.href} href={l.href} className={isActive(l.href) ? "active" : ""}>{l.label}</a>)}
          {mobileExtra}
        </div>
      )}
    </>
  );
}
