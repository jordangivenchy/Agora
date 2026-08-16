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
  description: "Join live debates, challenge ideas, and sharpen your arguments.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmMono.variable} h-full`}>
      <head>
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
