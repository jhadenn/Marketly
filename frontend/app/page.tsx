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
      <div className="pointer-events-none absolute inset-x-0 top-0 w-full h-[96svh] min-h-[42rem] sm:h-[104svh] sm:min-h-[48rem] md:h-[112svh] md:min-h-[54rem] lg:h-[122svh] lg:min-h-[68rem] xl:h-[126svh] xl:min-h-[74rem]">
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
      <div className="relative z-10 bg-background">
        <Features />
        <Agenda />
        <CallToAction />
        <FooterSection />
      </div>
      <Analytics />
    </div>
  );
}
