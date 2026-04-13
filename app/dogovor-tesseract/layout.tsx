import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Договор · Tesseract",
  description: "Три документа через Tesseract и договор через dogovor_new",
};

export default function DogovorTesseractLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
