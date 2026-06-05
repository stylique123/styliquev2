// Store route group layout — includes the editorial store Nav, Footer, and Tour.
// Applied to: /demo, /collection/*, /product/*, /privacy, /terms
import { Suspense } from "react";
import Nav from "../components/store/Nav";
import Footer from "../components/store/Footer";
import Tour from "../components/tour/Tour";

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      {children}
      <Footer />
      <Suspense fallback={null}>
        <Tour />
      </Suspense>
    </>
  );
}
