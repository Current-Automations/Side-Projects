"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{
        background: "rgba(10,10,10,0.94)",
        backdropFilter: "blur(18px)",
        borderColor: "rgba(255,255,255,0.07)",
      }}
    >
      <div className="container-shell flex h-16 items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          {!imgFailed ? (
            <Image
              src="/RevRide-Logo.jpg"
              alt="RevRide Auto"
              width={120}
              height={120}
              className="h-12 w-auto object-contain"
              onError={() => setImgFailed(true)}
              priority
            />
          ) : (
            <span
              className="text-base font-bold uppercase tracking-widest"
              style={{ color: "var(--gold)", fontFamily: "var(--font-oswald), sans-serif" }}
            >
              RevRide Auto
            </span>
          )}
        </Link>

        {/* Desktop CTAs */}
        <div className="hidden items-center gap-3 sm:flex">
          <a
            href="https://www.instagram.com/RevRide.Auto"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline py-2.5 px-5 text-xs"
          >
            <svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24" className="shrink-0">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
            </svg>
            DM Us
          </a>
          <a href="tel:+13435520222" className="btn-primary py-2.5 px-5 text-xs">
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} className="shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
            </svg>
            Call Now
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          className="flex h-10 w-10 items-center justify-center rounded-lg sm:hidden"
          style={{ color: "var(--gold)", border: "1px solid var(--gold-border)" }}
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? (
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div
          className="border-t sm:hidden"
          style={{ background: "#0d0d0d", borderColor: "rgba(255,255,255,0.07)" }}
        >
          <div className="container-shell flex flex-col gap-3 py-5">
            <a href="tel:+13435520222" className="btn-primary text-center">
              Call +1 (343) 552-0222
            </a>
            <a
              href="https://www.instagram.com/RevRide.Auto"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline text-center"
            >
              DM on Instagram @RevRide.Auto
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
