"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";

export default function Navbar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const isActive = (path: string) => {
    return pathname === path;
  };

  const navLinks: { href: string; label: string; sub?: { href: string; label: string } }[] = [
    { href: "/avisteikningar", label: "Avisteikningar", sub: { href: "/avisteikningar/avis", label: "Avis" } },
    { href: "/maleriar", label: "Maleriar", sub: { href: "/maleriar/galleri", label: "Galleri" } },
    { href: "/barnebokar", label: "Barnebøkar" },
    { href: "/om-meg", label: "Om meg" },
  ];

  return (
    <header className="bg-background sticky top-0 z-50 border-b border-gray-200/50">
      <div className="container mx-auto px-4">
        <nav className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="py-4 md:py-6 transition-opacity hover:opacity-80">
            <div className="relative w-24 md:w-32 h-12 md:h-16">
              <Image
                src="/logo_svart.png"
                alt="Wiken Design Logo"
                fill
                className="object-contain"
                priority
              />
            </div>
          </Link>

          {/* Desktop navigation */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <div key={link.href} className="flex items-baseline gap-3">
                <Link
                  href={link.href}
                  className={`relative py-2 text-gray-600 font-light tracking-wide transition-colors hover:text-gray-900 group ${
                    isActive(link.href) ? 'text-gray-900' : ''
                  }`}
                >
                  {link.label}
                  <span
                    className={`absolute bottom-0 left-0 w-full h-[1px] bg-gray-900 transform origin-left transition-transform duration-300 ${
                      isActive(link.href) ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
                    }`}
                  />
                </Link>
                {link.sub && (
                  <Link
                    href={link.sub.href}
                    prefetch={false}
                    className={`relative py-2 text-sm text-gray-600 font-light tracking-wide transition-colors hover:text-gray-900 group before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-full before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] ${
                      isActive(link.sub.href) ? 'text-gray-900' : ''
                    }`}
                  >
                    {link.sub.label}
                    <span
                      className={`absolute bottom-0 left-0 w-full h-[1px] bg-gray-900 transform origin-left transition-transform duration-300 motion-reduce:transition-none ${
                        isActive(link.sub.href) ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
                      }`}
                    />
                  </Link>
                )}
              </div>
            ))}
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden p-2 text-gray-700 hover:text-black"
            aria-label="Toggle menu"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              {isOpen ? (
                <path d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </nav>

        {/* Mobile navigation */}
        {isOpen && (
          <div className="md:hidden py-4 border-t border-gray-200/50">
            {navLinks.map((link) => (
              <div key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className={`block py-3 px-3 my-1 text-gray-600 font-light tracking-wide transition-colors hover:text-gray-900 ${
                    isActive(link.href) ? 'text-gray-900 border-l-2 border-gray-900' : ''
                  }`}
                >
                  {link.label}
                </Link>
                {link.sub && (
                  <Link
                    href={link.sub.href}
                    prefetch={false}
                    onClick={() => setIsOpen(false)}
                    className={`block py-3 pl-8 pr-3 my-1 text-sm text-gray-600 font-light tracking-wide transition-colors hover:text-gray-900 ${
                      isActive(link.sub.href) ? 'text-gray-900 border-l-2 border-gray-900' : ''
                    }`}
                  >
                    {link.sub.label}
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
