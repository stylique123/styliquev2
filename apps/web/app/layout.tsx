import type { Metadata } from "next";
import "./globals.css";
import MiraWidget from "./components/mira/MiraWidget";

export const metadata: Metadata = {
  title: "Stylique — Brand Intelligence Platform",
  description:
    "Stylique gives fashion brands an AI stylist, virtual try-on, and creative studio. Connect your Shopify store to get started.",
  themeColor: "#08070A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <MiraWidget />
      </body>
    </html>
  );
}
