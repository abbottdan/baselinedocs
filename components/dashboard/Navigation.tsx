'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { FeedbackButton } from '@/components/FeedbackButton';
import { BaselineDocsIconLight, BaselineDocsLogoLight, ClearStrideIconDark } from './BaselineDocsLogo';

type Props = {
  user: {
    email: string;
    fullName: string;
  }
  companyLogo?: string | null;
  isAdmin: boolean;
  userRole: string | null;
};

export default function Navigation({ user, isAdmin , companyLogo: companyLogoProp = null }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [companyLogo, setCompanyLogo] = useState<string | null>(companyLogoProp ?? null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch tenant company logo
  // companyLogo is passed as a prop from app/layout.tsx

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  const navItems = [
    {
      href: '/dashboard',
      label: 'Dashboard',
      icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    },
    {
      href: '/documents',
      label: 'All Documents',
      icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    },
    {
      href: '/approvals',
      label: 'Approvals',
      icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    {
      href: '/bookmarks',
      label: 'Bookmarks',
      icon: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z',
    },
    {
      href: '/help',
      label: 'Help',
      icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    },
  ];

  if (isAdmin) {
    navItems.push({
      href: '/admin/users',
      label: 'Admin Panel',
      icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
    });
  }

  return (
    // Dark Slate navbar — brand spec §10.1
    <nav className="bg-[#1E293B] border-b border-[#2d3f57]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14 gap-2">

          {/* Left — BaselineDocs logo + optional tenant co-brand */}
          <div className="flex-shrink-0 flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              {/* Icon-only at small breakpoints, full logo at lg+ */}
              <span className="lg:hidden">
                <BaselineDocsIconLight className="h-7 w-7" />
              </span>
              <span className="hidden lg:flex items-center">
                <BaselineDocsLogoLight className="h-7" />
              </span>
            </Link>

            {/* Tenant co-brand — only renders when a logo URL is actually set */}
            {companyLogo ? (
              <>
                <div className="h-5 w-px bg-[#3d5068] hidden lg:block" aria-hidden="true" />
                <div className="relative h-6 w-24 hidden lg:block flex-shrink-0">
                  <Image
                    src={companyLogo}
                    alt="Company logo"
                    fill
                    className="object-contain brightness-0 invert opacity-80"
                  />
                </div>
              </>
            ) : null}
          </div>

          {/* Center — nav items */}
          <div className="hidden sm:flex items-center gap-0.5 lg:gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    inline-flex items-center px-3 py-2 text-sm font-medium rounded-md whitespace-nowrap
                    transition-colors duration-150
                    ${isActive
                      ? 'text-white bg-white/10'
                      : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }
                  `}
                >
                  {/* Blue underline indicator for active item — brand spec §10.1 */}
                  <span className="relative flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d={item.icon}
                      />
                    </svg>
                    {item.label}
                    {isActive && (
                      <span
                        className="absolute -bottom-2 left-0 right-0 h-0.5 rounded-full"
                        style={{ backgroundColor: '#2563EB' }}
                      />
                    )}
                  </span>
                </Link>
              );
            })}
          </div>

          {/* Right — Feedback + user dropdown */}
          <div className="flex-shrink-0 flex items-center gap-2">
            <FeedbackButton />

            {/* User dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium
                  text-slate-200 bg-white/5 border border-white/10
                  hover:bg-white/10 hover:text-white
                  transition-colors duration-150 whitespace-nowrap"
              >
                {/* Amber avatar ring — brand spec §10.1 */}
                <span
                  className="inline-flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: '#D97706' }}
                  aria-hidden="true"
                >
                  {(user.fullName || user.email).charAt(0).toUpperCase()}
                </span>
                <span className="hidden md:inline truncate max-w-[150px]">
                  {user.fullName || user.email}
                </span>
                <span className="md:hidden">Account</span>
                <svg
                  className={`w-4 h-4 transition-transform duration-150 ${isDropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown menu */}
              {isDropdownOpen && (
                <div className="absolute right-0 mt-2 w-60 bg-white rounded-md shadow-lg border border-slate-200 py-1 z-50">
                  {/* User info */}
                  <div className="px-4 py-3 border-b border-slate-100">
                    <p className="text-sm font-medium text-slate-900">{user.fullName}</p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>

                  {/* Menu items */}
                  <Link
                    href="/settings/notifications"
                    onClick={() => setIsDropdownOpen(false)}
                    className="flex items-center px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <svg className="w-4 h-4 mr-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    Email Notifications
                  </Link>

                  <div className="border-t border-slate-100 my-1" />

                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <svg className="w-4 h-4 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign Out
                  </button>

                  {/* ClearStride ecosystem mention — subtle brand footer */}
                  <div className="px-4 py-2.5 border-t border-slate-100 mt-1">
                    <Link
                      href="https://clearstridetools.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                      onClick={() => setIsDropdownOpen(false)}
                    >
                      <ClearStrideIconDark className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>Part of ClearStride Tools</span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile nav */}
      <div className="sm:hidden border-t border-[#2d3f57]">
        <div className="px-2 pt-2 pb-3 space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors
                  ${isActive
                    ? 'text-white bg-white/10 border-l-2 border-[#2563EB]'
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                  }
                `}
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
          <Link
            href="/settings/notifications"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            Email Notifications
          </Link>
        </div>
      </div>
    </nav>
  );
}
