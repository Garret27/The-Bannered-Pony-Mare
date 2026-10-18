"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConverterAgentMenu } from "./ConverterAgentMenu";
import { SettingsGearLink } from "./SettingsGearLink";
import styles from "./Nav.module.css";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/movies", label: "Movies" },
  { href: "/movies/space-saver", label: "Space Saver" },
  { href: "/tv", label: "TV Shows" },
  { href: "/cdn", label: "CDN" },
  { href: "/subtitles", label: "Subtitles" },
  { href: "/posters", label: "Poster Search" },
  { href: "/invites", label: "Invites" },
  { href: "/movie-picture", label: "Movie Picture" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <span className={styles.brand}>Movie Night</span>
        <ul className={styles.links}>
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={
                  pathname === link.href ||
                  (link.href === "/subtitles" && pathname.startsWith("/subtitles")) ||
                  (link.href === "/movies" && pathname === "/movies") ||
                  (link.href === "/movies/space-saver" &&
                    (pathname.startsWith("/movies/space-saver") ||
                      pathname.startsWith("/tv/space-saver"))) ||
                  (link.href === "/tv" &&
                    pathname.startsWith("/tv") &&
                    !pathname.startsWith("/tv/space-saver")) ||
                  (link.href === "/cdn" && pathname.startsWith("/cdn")) ||
                  (link.href === "/movie-picture" && pathname.startsWith("/movie-picture"))
                    ? styles.active
                    : undefined
                }
              >
                {link.label}
              </Link>
            </li>
          ))}
          <li className={styles.gearSlot}>
            <ConverterAgentMenu />
            <SettingsGearLink />
          </li>
        </ul>
      </div>
    </nav>
  );
}
