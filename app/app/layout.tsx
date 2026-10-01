import type { ReactNode } from "react";
import "./globals.css";
import { Header } from "../components/Header";
import { Providers } from "./providers";

export const metadata = { title: "PULSO" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <div className="notice">NOT AUDITED · DEVNET DEMONSTRATION ONLY</div>
        <Providers>
          <Header />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
