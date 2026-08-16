import {
  translateDesktop,
} from "@minke/desktop/i18n";
import type { DesktopLocale } from "@minke/desktop/locale-contract";

export interface AppProps {
  locale: DesktopLocale;
}

export default function App({ locale }: AppProps) {
  return (
    <main className="grid min-h-screen place-items-center bg-transparent text-slate-100">
      <div className="flex flex-col items-center gap-5">
        <img
          className="size-20 rounded-[22%] shadow-2xl shadow-black/30"
          src="/minke.svg"
          alt="Minke"
        />
        <div className="flex items-center gap-2.5 text-sm text-slate-300">
          <span className="size-1.5 animate-pulse rounded-full bg-blue-300" />
          {translateDesktop(locale, "bootstrap.loading")}
        </div>
      </div>
    </main>
  );
}
