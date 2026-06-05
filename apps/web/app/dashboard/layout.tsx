// Dashboard layout — no store Nav/Footer, no Tour
// The dashboard page handles its own header/footer inline.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stylique Brand Portal",
  description: "Analytics, settings, and intelligence for your Stylique-powered store.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
