import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 py-16 text-zinc-100">
      <main className="max-w-lg text-center">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-amber-500/90">
          tesseract · frontend
        </p>
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Демо Next.js
        </h1>
        <p className="mt-4 text-pretty text-sm leading-relaxed text-zinc-400 sm:text-base">
          Скан паспорта через Hugging Face и формирование договора — на отдельной
          странице с тем же API, что и Streamlit.
        </p>
        <Link
          href="/passport-hf"
          className="mt-10 inline-flex items-center justify-center rounded-full bg-gradient-to-r from-amber-600 to-amber-400 px-8 py-3 text-sm font-semibold text-zinc-950 shadow-lg shadow-amber-900/30 transition hover:brightness-110"
        >
          Открыть скан паспорта
        </Link>
      </main>
    </div>
  );
}
