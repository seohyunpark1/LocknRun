import WalletProvider from "@/components/WalletProvider";
import "./globals.css";
import "./polish.css";
import "./theme.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Lock&Run — bet on your own run",
  description:
    "Stake USDC on your running goal. Finish and get your stake back plus a share of the pool. On Solana.",
  manifest: "/manifest.webmanifest",
  applicationName: "Lock&Run",
  appleWebApp: { capable: true, title: "Lock&Run", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // use the full screen on notched phones when installed
  themeColor: "#0f1110",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><WalletProvider>{children}</WalletProvider></body>
    </html>
  );
}
