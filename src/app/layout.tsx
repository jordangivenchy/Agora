import type { Metadata } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import UserMenuProvider from "@/components/UserContextMenu";
import SettingsBoot from "@/components/SettingsBoot";
import PresenceBoot from "@/components/PresenceBoot";
import MessagesDock from "@/components/messages/MessagesDock";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "AgoraSphere — Live Discussion Platform",
  description: "Join live discussions, challenge ideas, and sharpen your arguments.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmMono.variable} h-full`}>
      <head>
        {/* Back/forward cache guard: some restores replay the cached HTML
            shell without executing the inline React flight scripts —
            self.__next_f stays empty, hydration never happens, and the
            user sees a dead black page. Detect that shell after a
            back_forward load and reload once (session flag stops loops). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.addEventListener("load",function(){setTimeout(function(){try{var nav=performance.getEntriesByType("navigation")[0];var dead=!self.__next_f||self.__next_f.length===0;if(nav&&nav.type==="back_forward"&&dead){if(!sessionStorage.getItem("ag-bf-reload")){sessionStorage.setItem("ag-bf-reload","1");location.reload();}}else{sessionStorage.removeItem("ag-bf-reload");}}catch(e){}},150);});`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Literal font-family names ('Space Grotesk', 'DM Sans', 'DM Mono')
            are referenced throughout the CSS, so these load under their real
            names here — next/font's hashed families only cover the body
            default. Space Grotesk tops out at 700; 800 usages clamp down. */}
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-full flex flex-col font-[family-name:var(--font-dm-sans)]">
        <SettingsBoot />
        <PresenceBoot />
        <UserMenuProvider>
          {children}
          <MessagesDock />
        </UserMenuProvider>
      </body>
    </html>
  );
}
