'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck, ArrowRight, Table, Page,
  NavArrowDown, NavArrowUp, ViewGrid, Sparks, Fingerprint,
  Community, CloudSync, GitFork,
} from 'iconoir-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

interface LandingPageProps {
  onOpenAuth: () => void;
  onOpenCreateCompany: () => void;
  onOpenJoinCompany: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onOpenAuth,
  onOpenCreateCompany,
  onOpenJoinCompany,
}) => {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  const headerRef = useRef<HTMLDivElement>(null);
  const heroContentRef = useRef<HTMLDivElement>(null);
  const heroTitleRef = useRef<HTMLHeadingElement>(null);
  const heroSubtitleRef = useRef<HTMLParagraphElement>(null);
  const heroButtonsRef = useRef<HTMLDivElement>(null);
  const bentoSectionRef = useRef<HTMLDivElement>(null);
  const faqSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    // Initial state setup to prevent FOUC (flash of unstyled content)
    gsap.set(headerRef.current, { y: -30, autoAlpha: 0 });
    gsap.set(heroTitleRef.current, { y: 50, rotate: 0.5, autoAlpha: 0 });
    gsap.set(heroSubtitleRef.current, { y: 30, autoAlpha: 0 });
    if (heroButtonsRef.current) {
      gsap.set(heroButtonsRef.current.children, { y: 20, autoAlpha: 0 });
    }

    const tl = gsap.timeline();

    // 1. Navbar slide down and fade in
    tl.to(headerRef.current, {
      y: 0,
      autoAlpha: 1,
      duration: 0.8,
      ease: 'power3.out',
    })
    // 2. Hero Title Staggered Slide up + subtle rotation reveal
    .to(heroTitleRef.current, {
      y: 0,
      rotate: 0,
      autoAlpha: 1,
      duration: 1.2,
      ease: 'power4.out',
    }, '-=0.4')
    // 3. Hero Subtitle fade & slide up
    .to(heroSubtitleRef.current, {
      y: 0,
      autoAlpha: 1,
      duration: 1.0,
      ease: 'power3.out',
    }, '-=0.8')
    // 4. Hero Action Buttons fade & slide up
    if (heroButtonsRef.current) {
      tl.to(heroButtonsRef.current.children, {
        y: 0,
        autoAlpha: 1,
        duration: 0.8,
        stagger: 0.1,
        ease: 'power3.out',
      }, '-=0.7');
    }

    // 5. Bento Grid Section ScrollTrigger
    if (bentoSectionRef.current) {
      const bentoHeader = bentoSectionRef.current.querySelector('.bento-header');
      const bentoCards = bentoSectionRef.current.querySelectorAll('.bento-card');

      gsap.fromTo(bentoHeader,
        { y: 40, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: bentoHeader,
            start: 'top 85%',
          }
        }
      );

      gsap.fromTo(bentoCards,
        { y: 60, scale: 0.97, autoAlpha: 0 },
        {
          y: 0,
          scale: 1,
          autoAlpha: 1,
          duration: 1.2,
          stagger: 0.08,
          ease: 'power4.out',
          scrollTrigger: {
            trigger: bentoSectionRef.current.querySelector('.bento-grid'),
            start: 'top 80%',
          }
        }
      );
    }

    // 6. FAQ Section ScrollTrigger
    if (faqSectionRef.current) {
      const faqHeader = faqSectionRef.current.querySelector('.faq-header');
      const faqCards = faqSectionRef.current.querySelectorAll('.faq-card');

      gsap.fromTo(faqHeader,
        { y: 30, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: faqHeader,
            start: 'top 85%',
          }
        }
      );

      gsap.fromTo(faqCards,
        { y: 40, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 1.0,
          stagger: 0.05,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: faqSectionRef.current.querySelector('.faq-list'),
            start: 'top 80%',
          }
        }
      );
    }
  }, []);

  const faqs = [
    {
      q: 'What makes TheySynced different from Discord or Teams?',
      a: 'TheySynced is engineered specifically for modern technical teams requiring high-performance real-time collaboration. It integrates official Excalidraw whiteboards, multi-sheet Excel statistical spreadsheets, Notion markdown docs, and HD WebRTC conferencing into a single unified workspace built on Rust Axum and Next.js.',
    },
    {
      q: 'Can companies host their own public SEO/AEO website on TheySynced?',
      a: 'Yes! Every company created on TheySynced can publish a public microsite at /c/company_id. Admins can customize headlines, descriptions, and FAQs, complete with structured JSON-LD schemas automatically readable by search engines and AI engines like ChatGPT and Perplexity.',
    },
    {
      q: 'How does the 15-minute Admin OTP passcode work?',
      a: 'Company Admins & Owners can generate single-use 6-digit OTP passcodes. Teammates can enter the OTP passcode directly during sign-up or workspace joining, bypassing permanent join codes for fast and secure onboarding.',
    },
    {
      q: 'Is offline persistence supported for whiteboards and spreadsheets?',
      a: 'Yes! All workspace whiteboards, spreadsheets, docs, and PDFs are cached locally in browser IndexedDB. When internet connectivity drops, your changes remain safe offline and automatically sync to the backend when reconnected.',
    },
    {
      q: 'Can I lock my account with a passkey or Face ID / Touch ID?',
      a: 'Yes. Once you enroll a passkey from your profile settings, every future sign-in asks for your password first and then a biometric passkey check before a session is granted. Accounts without a passkey enrolled skip that step entirely.',
    },
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FB] text-slate-900 font-sans selection:bg-indigo-500 selection:text-white">

      {/* Navbar */}
      <header ref={headerRef} className="sticky top-0 z-40 bg-[#F8F9FB]/80 backdrop-blur-xl border-b border-black/[0.04] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-xl font-medium text-slate-950 tracking-tight">TheySynced</span>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={onOpenAuth}
              className="px-5 py-2.5 rounded-full text-xs font-medium text-slate-700 hover:text-slate-950 hover:bg-slate-100 transition-all"
            >
              Sign In
            </button>
            <button
              onClick={onOpenCreateCompany}
              className="px-6 py-2.5 bg-slate-900 text-white rounded-full text-xs font-medium hover:bg-slate-800 transition-all shadow-md flex items-center gap-1.5"
            >
              <span>Get Started</span>
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </header>

      {/* Hero — full viewport */}
      <section className="relative min-h-[calc(100svh-73px)] flex items-center px-6 overflow-hidden">
        {/* soft Apple-style gradient blobs, using existing palette */}
        <div className="pointer-events-none absolute -top-32 -left-24 w-[520px] h-[520px] rounded-full bg-[#E0E3FF] opacity-60 blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-40 -right-24 w-[520px] h-[520px] rounded-full bg-[#F4F2EC] opacity-70 blur-[100px]" />
        <div className="pointer-events-none absolute top-1/3 right-1/4 w-[320px] h-[320px] rounded-full bg-[#7F7149] opacity-[0.07] blur-[100px]" />

        <div ref={heroContentRef} className="relative max-w-7xl mx-auto w-full text-left">
          <h1 ref={heroTitleRef} className="text-6xl sm:text-8xl font-thin text-slate-950 tracking-tight max-w-5xl leading-[1.03]">
            Where technical teams <br />
            <span className="font-medium text-slate-950">
              sync whiteboards, sheets &amp; meetings.
            </span>
          </h1>

          <p ref={heroSubtitleRef} className="mt-8 text-lg sm:text-xl text-slate-500 max-w-2xl font-light leading-relaxed">
            The real-time office platform for modern enterprises — Excalidraw system diagrams,
            statistical spreadsheets, and WebRTC video calls, wrapped in a clean, high-performance light UI.
          </p>

          <div ref={heroButtonsRef} className="mt-12 flex flex-wrap items-center justify-start gap-4">
            <button
              onClick={onOpenCreateCompany}
              className="px-8 py-4 bg-slate-900 text-white rounded-full font-medium text-sm hover:bg-slate-800 transition-all shadow-xl flex items-center gap-2"
            >
              <span>Create Your Company Profile</span>
              <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
            </button>

            <button
              onClick={onOpenJoinCompany}
              className="px-8 py-4 bg-white text-slate-900 rounded-full font-medium text-sm hover:bg-slate-50 transition-all border border-slate-200/90 shadow-sm flex items-center gap-2"
            >
              <ShieldCheck className="w-4 h-4 text-indigo-600" strokeWidth={1.75} />
              <span>Join with Admin OTP</span>
            </button>
          </div>
        </div>
      </section>

      {/* Bento grid — full viewport, existing color tokens */}
      <section ref={bentoSectionRef} className="min-h-screen flex items-center px-6 py-24 bg-white/60 border-y border-black/[0.04]">
        <div className="max-w-6xl mx-auto w-full">
          <div className="text-center mb-12 bento-header">
            <h2 className="text-4xl sm:text-5xl font-thin text-slate-950 tracking-tight">Integrated office platform suite</h2>
            <p className="mt-3 text-slate-500 font-light">One organic squircle bento grid, every real-time tool your team needs.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-6 auto-rows-[220px] bento-grid">
            {/* Excalidraw — olive, wide */}
            <div className="bento-card md:col-span-4 md:row-span-2 bg-[#7F7149] text-white rounded-[36px] p-8 flex flex-col justify-between shadow-lg relative overflow-hidden group">
              <div>
                <span className="text-[11px] font-medium tracking-widest uppercase text-amber-200">Realtime vector whiteboard</span>
                <h3 className="text-3xl font-thin mt-2">Excalidraw System Canvas</h3>
                <p className="text-sm text-amber-100/90 mt-3 leading-relaxed font-light max-w-md">
                  Sketch architecture diagrams, flowcharts, sticky notes, and vector drawings live with WebSockets.
                </p>
              </div>
              <button onClick={onOpenCreateCompany} className="mt-8 self-start px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full text-xs font-medium transition-all border border-white/20 flex items-center gap-2">
                <span>Launch canvas</span>
                <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>
              <GitFork className="w-28 h-28 absolute -right-4 -bottom-4 text-white/[0.08]" strokeWidth={1} />
            </div>

            {/* Voice/Video — periwinkle */}
            <div className="bento-card md:col-span-2 md:row-span-2 bg-[#E0E3FF] text-[#181A2A] rounded-[36px] p-8 flex flex-col justify-between shadow-lg relative overflow-hidden">
              <div>
                <span className="text-[11px] font-medium tracking-widest uppercase text-indigo-700">Voice channels &amp; video</span>
                <h3 className="text-2xl font-thin mt-2">HD WebRTC Mesh</h3>
                <p className="text-xs text-indigo-950/80 mt-3 leading-relaxed font-light">
                  Persistent voice channels with pre-join avatar previews and WebRTC conferencing.
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
                <Community className="w-5 h-5" strokeWidth={1.75} />
              </div>
            </div>

            {/* Spreadsheets — white */}
            <div className="bento-card md:col-span-2 bg-white rounded-[36px] p-8 flex flex-col justify-between border border-slate-200/90 shadow-md">
              <div>
                <span className="text-[11px] font-medium tracking-widest uppercase text-slate-400">Statistical analytics</span>
                <h3 className="text-xl font-thin text-slate-950 mt-2">Excel-grade Grid</h3>
                <p className="text-xs text-slate-500 mt-3 leading-relaxed font-light">
                  Full numerical grid calculation with formulas, context menus, and CSV export.
                </p>
              </div>
              <button onClick={onOpenCreateCompany} className="mt-6 self-start px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-full text-xs font-medium transition-all flex items-center gap-2">
                <Table className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Open spreadsheet</span>
              </button>
            </div>

            {/* Offline sync — beige/cream */}
            <div className="bento-card md:col-span-2 bg-[#F4F2EC] text-slate-900 rounded-[36px] p-8 flex flex-col justify-between shadow-md">
              <div>
                <span className="text-[11px] font-medium tracking-widest uppercase text-slate-500">Never lose your work</span>
                <h3 className="text-xl font-thin mt-2">Offline-first Sync</h3>
                <p className="text-xs text-slate-600 mt-3 leading-relaxed font-light">
                  Whiteboards, sheets, and docs cache locally and sync back the moment you reconnect.
                </p>
              </div>
              <CloudSync className="w-6 h-6 text-slate-500" strokeWidth={1.75} />
            </div>

            {/* Passkey security — purple accent */}
            <div className="bento-card md:col-span-2 bg-[#E3D8FF] text-[#2C1B4D] rounded-[36px] p-8 flex flex-col justify-between shadow-md">
              <div>
                <span className="text-[11px] font-medium tracking-widest uppercase text-purple-800">Account security</span>
                <h3 className="text-xl font-thin mt-2">Passkey Lock</h3>
                <p className="text-xs text-purple-950/80 mt-3 leading-relaxed font-light">
                  Enroll Face ID / Touch ID once — every sign-in after that asks for password, then passkey.
                </p>
              </div>
              <Fingerprint className="w-6 h-6 text-purple-800" strokeWidth={1.75} />
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section ref={faqSectionRef} className="py-24 px-6 max-w-4xl mx-auto">
        <div className="text-center mb-10 faq-header">
          <h2 className="text-4xl font-thin text-slate-950 tracking-tight">Frequently asked questions</h2>
          <p className="mt-3 text-slate-500 font-light">Everything about TheySynced&apos;s platform architecture and features.</p>
        </div>

        <div className="space-y-4 faq-list">
          {faqs.map((faq, idx) => (
            <div key={idx} className="faq-card bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm">
              <button
                onClick={() => setOpenFaqIndex(openFaqIndex === idx ? null : idx)}
                className="w-full text-left font-medium text-slate-950 flex items-center justify-between text-base"
              >
                <span>{faq.q}</span>
                {openFaqIndex === idx ? (
                  <NavArrowUp className="w-5 h-5 text-indigo-600" strokeWidth={1.75} />
                ) : (
                  <NavArrowDown className="w-5 h-5 text-slate-400" strokeWidth={1.75} />
                )}
              </button>
              {openFaqIndex === idx && (
                <p className="mt-3 text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-3 font-light">{faq.a}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-10 px-6 text-center text-xs text-slate-500 font-light flex items-center justify-center gap-2">
        <span>© 2026 TheySynced Office. Powered by Rust Axum &amp; Next.js 16.</span>
      </footer>

    </div>
  );
};
