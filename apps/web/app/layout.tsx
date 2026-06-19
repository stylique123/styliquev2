import type { Metadata } from "next";
import "./globals.css";
import MiraWidget from "./components/mira/MiraWidget";

export const metadata: Metadata = {
  title: "Stylique — AI Sales Engine for Fashion Brands",
  description:
    "Stylique is an AI sales associate for fashion brands — it guides shoppers, builds complete looks, and gets the fit right. Connect your Shopify store to get started.",
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
