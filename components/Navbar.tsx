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

  const navLinks = [
    { href: "/avisteikningar", label: "Avisteikningar" },
    { href: "/maleriar", label: "Maleriar" },
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
              <Link
                key={link.href}
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
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className={`block py-3 px-3 my-1 text-gray-600 font-light tracking-wide transition-colors hover:text-gray-900 ${
                  isActive(link.href) ? 'text-gray-900 border-l-2 border-gray-900' : ''
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
