import type { Metadata } from "next";
import { Manrope } from "next/font/google";

import "./passport-hf.css";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-passport",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Скан паспорта — Hugging Face",
  description:
    "Извлечение полей паспорта через модель Hugging Face и формирование договора",
};

export default function PassportHfLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className={`${manrope.variable} passport-hf-root font-sans antialiased`}>
      {children}
    </div>
  );
}
