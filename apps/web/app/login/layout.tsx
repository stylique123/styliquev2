// Login layout — no store Nav/Footer
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect your store — Stylique Brand Portal",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
