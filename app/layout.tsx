import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Manrope } from "next/font/google";
import "./globals.css";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-passport",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tesseract · front",
  description: "Next.js интерфейс к OCR и договорам",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col"
        suppressHydrationWarning
      >
        <header className="sticky top-0 z-50 border-b border-slate-200/90 bg-white/90 backdrop-blur-md">
          <nav
            className="mx-auto flex max-w-5xl flex-wrap items-center gap-1 px-4 py-3 text-sm"
            aria-label="Разделы"
          >
            <Link
              href="/"
              className="rounded-lg px-3 py-2 font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
            >
              3 документа · HF
            </Link>
            <Link
              href="/dogovor-tesseract"
              className="rounded-lg px-3 py-2 font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
            >
              Договор · Tesseract
            </Link>
            <Link
              href="/scan-two-models"
              className="rounded-lg px-3 py-2 font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
            >
              3 документа · 2 модели
            </Link>
            <Link
              href="/scan-paspread"
              className="rounded-lg px-3 py-2 font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
            >
              paspread
            </Link>
            <Link
              href="/scan-russian-docs-ocr"
              className="rounded-lg px-3 py-2 font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
            >
              RussianDocsOCR
            </Link>
            <Link
              href="/scan-deepseek-qwen"
              className="rounded-lg px-3 py-2 font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
            >
              DeepSeek + Qwen
            </Link>
          </nav>
        </header>
        <div className="passport-hf-root flex-1 font-sans antialiased">{children}</div>
      </body>
    </html>
  );
}
