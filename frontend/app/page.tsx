import { Analytics } from "@vercel/analytics/next";
import HeroSection from "@/components/hero-section";
import Features from "@/components/features-3";
import Agenda from "@/components/agenda";
import CallToAction from "@/components/call-to-action";
import Dither from "@/components/Dither";
import FooterSection from "@/components/footer";
import { HeroHeader } from "@/components/header";

export default function Home() {
  return (
    <div className="dark font-sans antialiased">
      <div className="absolute w-full h-dvh max-h-155 sm:max-h-115 md:max-h-125 lg:max-h-190 xl:max-h-195">
        <Dither
          waveColor={[0.30980392156862746, 0.30980392156862746, 0.30980392156862746]}
          disableAnimation={false}
          enableMouseInteraction
          mouseRadius={0.3}
          colorNum={4}
          pixelSize={2}
          waveAmplitude={0.3}
          waveFrequency={3}
          waveSpeed={0.05}
        />
      </div>
      <HeroHeader />
      <HeroSection />
      <Features />
      <Agenda />
      <CallToAction />
      <FooterSection />
      <Analytics />
    </div>
  );
}
