"use client";

import { Swiper, SwiperSlide } from "swiper/react";
import { Keyboard, Pagination, Navigation, Mousewheel } from "swiper/modules";

import { useEventImages } from "./lib/useEventImages";
import { TitleSlide } from "./slides/TitleSlide";
import { ManifestoSlide } from "./slides/ManifestoSlide";
import { ProblemSlide } from "./slides/ProblemSlide";
import { MarketSlide } from "./slides/MarketSlide";
import { SolutionOverviewSlide } from "./slides/SolutionOverviewSlide";
import { PipelineSlide } from "./slides/PipelineSlide";
import { FeaturesSlide } from "./slides/FeaturesSlide";
import { MetricsSlide } from "./slides/MetricsSlide";
import { ROISlide } from "./slides/ROISlide";
import { DemoBackupSlide } from "./slides/DemoBackupSlide";
import { CloseSlide } from "./slides/CloseSlide";

export default function App() {
  const { events } = useEventImages(48);

  return (
    <Swiper
      modules={[Keyboard, Pagination, Navigation, Mousewheel]}
      keyboard={{ enabled: true }}
      navigation
      pagination={{ clickable: true }}
      mousewheel={{ forceToAxis: true, sensitivity: 1, thresholdDelta: 30 }}
      speed={420}
      spaceBetween={0}
      slidesPerView={1}
    >
      <SwiperSlide>
        <TitleSlide events={events} />
      </SwiperSlide>
      <SwiperSlide>
        <ManifestoSlide />
      </SwiperSlide>
      <SwiperSlide>
        <ProblemSlide events={events} />
      </SwiperSlide>
      <SwiperSlide>
        <MarketSlide events={events} />
      </SwiperSlide>
      <SwiperSlide>
        <SolutionOverviewSlide events={events} />
      </SwiperSlide>
      <SwiperSlide>
        <PipelineSlide />
      </SwiperSlide>
      <SwiperSlide>
        <FeaturesSlide events={events} />
      </SwiperSlide>
      <SwiperSlide>
        <MetricsSlide />
      </SwiperSlide>
      <SwiperSlide>
        <ROISlide />
      </SwiperSlide>
      <SwiperSlide>
        <DemoBackupSlide events={events} />
      </SwiperSlide>
      <SwiperSlide>
        <CloseSlide events={events} />
      </SwiperSlide>
    </Swiper>
  );
}
