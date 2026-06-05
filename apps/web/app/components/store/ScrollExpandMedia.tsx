"use client";

import {
  useEffect,
  useRef,
  useState,
  ReactNode,
  TouchEvent,
  WheelEvent,
} from "react";
import Image from "next/image";
import { motion } from "framer-motion";

interface ScrollExpandMediaProps {
  mediaType?: "video" | "image";
  mediaSrc: string;
  posterSrc?: string;
  bgImageSrc: string;
  title?: string;
  date?: string;
  scrollToExpand?: string;
  textBlend?: boolean;
  children?: ReactNode;
}

const ScrollExpandMedia = ({
  mediaType = "video",
  mediaSrc,
  posterSrc,
  bgImageSrc,
  title,
  date,
  scrollToExpand,
  textBlend,
  children,
}: ScrollExpandMediaProps) => {
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [showContent, setShowContent] = useState<boolean>(false);
  const [mediaFullyExpanded, setMediaFullyExpanded] = useState<boolean>(false);
  const [touchStartY, setTouchStartY] = useState<number>(0);
  const [isMobileState, setIsMobileState] = useState<boolean>(false);

  const sectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setScrollProgress(0);
    setShowContent(false);
    setMediaFullyExpanded(false);
  }, [mediaType]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (mediaFullyExpanded && e.deltaY < 0 && window.scrollY <= 5) {
        setMediaFullyExpanded(false);
        e.preventDefault();
      } else if (!mediaFullyExpanded) {
        e.preventDefault();
        const scrollDelta = e.deltaY * 0.0009;
        const newProgress = Math.min(Math.max(scrollProgress + scrollDelta, 0), 1);
        setScrollProgress(newProgress);
        if (newProgress >= 1) {
          setMediaFullyExpanded(true);
          setShowContent(true);
        } else if (newProgress < 0.75) setShowContent(false);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      setTouchStartY(e.touches[0].clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStartY) return;
      const touchY = e.touches[0].clientY;
      const deltaY = touchStartY - touchY;
      if (mediaFullyExpanded && deltaY < -20 && window.scrollY <= 5) {
        setMediaFullyExpanded(false);
        e.preventDefault();
      } else if (!mediaFullyExpanded) {
        e.preventDefault();
        const scrollFactor = deltaY < 0 ? 0.008 : 0.005;
        const scrollDelta = deltaY * scrollFactor;
        const newProgress = Math.min(Math.max(scrollProgress + scrollDelta, 0), 1);
        setScrollProgress(newProgress);
        if (newProgress >= 1) {
          setMediaFullyExpanded(true);
          setShowContent(true);
        } else if (newProgress < 0.75) setShowContent(false);
        setTouchStartY(touchY);
      }
    };

    const handleTouchEnd = () => setTouchStartY(0);
    const handleScroll = () => {
      if (!mediaFullyExpanded) window.scrollTo(0, 0);
    };

    window.addEventListener("wheel", handleWheel as unknown as EventListener, { passive: false });
    window.addEventListener("scroll", handleScroll as EventListener);
    window.addEventListener("touchstart", handleTouchStart as unknown as EventListener, { passive: false });
    window.addEventListener("touchmove", handleTouchMove as unknown as EventListener, { passive: false });
    window.addEventListener("touchend", handleTouchEnd as EventListener);

    return () => {
      window.removeEventListener("wheel", handleWheel as unknown as EventListener);
      window.removeEventListener("scroll", handleScroll as EventListener);
      window.removeEventListener("touchstart", handleTouchStart as unknown as EventListener);
      window.removeEventListener("touchmove", handleTouchMove as unknown as EventListener);
      window.removeEventListener("touchend", handleTouchEnd as EventListener);
    };
  }, [scrollProgress, mediaFullyExpanded, touchStartY]);

  useEffect(() => {
    const checkIfMobile = () => setIsMobileState(window.innerWidth < 768);
    checkIfMobile();
    window.addEventListener("resize", checkIfMobile);
    return () => window.removeEventListener("resize", checkIfMobile);
  }, []);

  const mediaWidth = 300 + scrollProgress * (isMobileState ? 650 : 1250);
  const mediaHeight = 400 + scrollProgress * (isMobileState ? 200 : 400);
  const textTranslateX = scrollProgress * (isMobileState ? 180 : 150);

  const firstWord = title ? title.split(" ")[0] : "";
  const restOfTitle = title ? title.split(" ").slice(1).join(" ") : "";

  return (
    <div ref={sectionRef} style={{ overflowX: "hidden", transition: "background 0.7s ease-in-out" }}>
      <section style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", minHeight: "100dvh" }}>
        <div style={{ position: "relative", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", minHeight: "100dvh" }}>
          <motion.div
            style={{ position: "absolute", inset: 0, zIndex: 0, height: "100%" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 - scrollProgress }}
            transition={{ duration: 0.1 }}
          >
            <Image
              src={bgImageSrc}
              alt="Background"
              width={1920}
              height={1080}
              style={{ width: "100vw", height: "100vh", objectFit: "cover", objectPosition: "center" }}
              priority
            />
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />
          </motion.div>

          <div style={{ width: "100%", maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", position: "relative", zIndex: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%", height: "100dvh", position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  zIndex: 0,
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%,-50%)",
                  borderRadius: 16,
                  width: `${mediaWidth}px`,
                  height: `${mediaHeight}px`,
                  maxWidth: "95vw",
                  maxHeight: "85vh",
                  boxShadow: "0 0 80px rgba(0,0,0,0.45)",
                  overflow: "hidden",
                }}
              >
                {mediaType === "video" ? (
                  <div style={{ position: "relative", width: "100%", height: "100%", pointerEvents: "none" }}>
                    <video
                      src={mediaSrc}
                      poster={posterSrc}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="auto"
                      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12 }}
                      controls={false}
                      disablePictureInPicture
                      disableRemotePlayback
                    />
                    <motion.div
                      style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", borderRadius: 12 }}
                      initial={{ opacity: 0.7 }}
                      animate={{ opacity: 0.5 - scrollProgress * 0.3 }}
                      transition={{ duration: 0.2 }}
                    />
                  </div>
                ) : (
                  <div style={{ position: "relative", width: "100%", height: "100%" }}>
                    <Image
                      src={mediaSrc}
                      alt={title || "Media content"}
                      width={1280}
                      height={720}
                      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12 }}
                    />
                    <motion.div
                      style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", borderRadius: 12 }}
                      initial={{ opacity: 0.7 }}
                      animate={{ opacity: 0.7 - scrollProgress * 0.3 }}
                      transition={{ duration: 0.2 }}
                    />
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", position: "relative", zIndex: 10, marginTop: 16 }}>
                  {date && (
                    <p style={{ fontSize: 22, color: "rgba(244,242,238,0.85)", transform: `translateX(-${textTranslateX}vw)` }}>{date}</p>
                  )}
                  {scrollToExpand && (
                    <p style={{ color: "rgba(244,242,238,0.85)", fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", transform: `translateX(${textTranslateX}vw)` }}>
                      {scrollToExpand}
                    </p>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  gap: 8,
                  width: "100%",
                  position: "relative",
                  zIndex: 10,
                  mixBlendMode: textBlend ? "difference" : "normal",
                  pointerEvents: "none",
                }}
              >
                <motion.h2
                  style={{
                    fontFamily: "var(--serif)",
                    fontWeight: 400,
                    fontSize: "clamp(56px,9vw,140px)",
                    lineHeight: 0.95,
                    color: "#F4F2EE",
                    margin: 0,
                    transform: `translateX(-${textTranslateX}vw)`,
                  }}
                >
                  {firstWord}
                </motion.h2>
                <motion.h2
                  style={{
                    fontFamily: "var(--serif)",
                    fontStyle: "italic",
                    fontWeight: 400,
                    fontSize: "clamp(56px,9vw,140px)",
                    lineHeight: 0.95,
                    color: "#F4F2EE",
                    margin: 0,
                    transform: `translateX(${textTranslateX}vw)`,
                  }}
                >
                  {restOfTitle}
                </motion.h2>
              </div>
            </div>

            <motion.section
              style={{ display: "flex", flexDirection: "column", width: "100%", padding: "80px 32px" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: showContent ? 1 : 0 }}
              transition={{ duration: 0.7 }}
            >
              {children}
            </motion.section>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ScrollExpandMedia;
