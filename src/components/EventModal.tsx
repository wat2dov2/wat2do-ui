import React, { useState, useEffect } from "react";
import { X, Users, Calendar, MapPin } from "lucide-react";
import { EventCard } from "./EventCard";
import type { Event } from "@/types";
import { mockEvents } from "@/data/events";

interface EventModalProps {
  event: Event;
  onClose: () => void;
}

export function EventModal({ event: initialEvent, onClose }: EventModalProps) {
  const [currentEvent, setCurrentEvent] = useState(initialEvent);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Get other events to show as similar events (excluding the current event)
  const similarEvents = mockEvents.filter((e) => e.id !== currentEvent.id).slice(0, 4);

  const handleEventChange = (newEvent: Event) => {
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentEvent(newEvent);
      setIsTransitioning(false);
    }, 150);
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={handleClose}
      />

      {/* Modal Sheet */}
      <div
        className="relative w-[calc(100%-48px)] rounded-t-2xl shadow-2xl overflow-hidden flex flex-col bg-white dark:bg-gray-900"
        style={{
          height: "calc(100dvh - 48px)",
          animation: "slideInFromBottom 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards",
        }}
      >
        {/* Top Gray Bar with Drag Handle */}
        <div
          className="relative w-full h-6 rounded-t-2xl flex items-center justify-center flex-shrink-0 bg-gray-600 dark:bg-gray-700"
        >
          <div className="w-24 h-1 rounded-full bg-white/40" />
        </div>

        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-20 w-10 h-10 backdrop-blur-md rounded-full flex items-center justify-center hover:bg-white dark:hover:bg-gray-700 transition-all shadow-lg group bg-white/90 dark:bg-gray-800/90"
          aria-label="Close modal"
        >
          <X className="w-5 h-5 text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors" strokeWidth={2.5} />
        </button>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          <div className={`transition-opacity duration-150 ${isTransitioning ? "opacity-0" : "opacity-100"}`}>
            {/* Background Image with Overlay */}
            <div className="relative" style={{ background: "linear-gradient(to bottom right, #e5e7eb, #d1d5db)" }}>
              {/* Darkened Background */}
              <div className="absolute inset-0" style={{ backgroundColor: "rgba(0,0,0,0.6)" }} />

              {/* Content Container */}
              <div className="relative w-full px-6 py-8 pb-16 space-y-8 max-w-7xl mx-auto">
                {/* Top Section: Image and Details */}
                <div className="flex items-center gap-8">
                  {/* Left: Event Image Square */}
                  <div className="w-[45%] flex items-center justify-center">
                    <div
                      className="aspect-square w-full max-w-xs rounded shadow-2xl"
                      style={{ background: "linear-gradient(to bottom right, #e5e7eb, #d1d5db)" }}
                    />
                  </div>

                  {/* Right: Event Details */}
                  <div className="flex-1 text-white space-y-4">
                    {/* Organization */}
                    <div className="flex gap-3 items-center">
                      <div
                        className="w-8 h-8 rounded-full backdrop-blur-md flex items-center justify-center"
                        style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
                      >
                        <Users className="w-4 h-4 text-white" strokeWidth={2.5} />
                      </div>
                      <span className="font-bold text-lg">{currentEvent.organization}</span>
                    </div>

                    {/* Event Badges */}
                    <div className="flex flex-wrap gap-1.5">
                      {currentEvent.price === 0 ? (
                        <span
                          className="font-medium text-[11px] px-2.5 py-1 rounded-xl"
                          style={{ backgroundColor: "rgba(16, 185, 129, 0.2)", color: "#10B981" }}
                        >
                          Free
                        </span>
                      ) : (
                        <span
                          className="font-medium text-[11px] px-2.5 py-1 rounded-xl"
                          style={{ backgroundColor: "rgba(59, 130, 246, 0.2)", color: "#3B82F6" }}
                        >
                          ${currentEvent.price}
                        </span>
                      )}

                      {currentEvent.food && currentEvent.food.length > 0 && (
                        <span
                          className="font-medium text-[11px] px-2.5 py-1 rounded-xl"
                          style={{ backgroundColor: "rgba(245, 158, 11, 0.2)", color: "#F59E0B" }}
                        >
                          Free Food
                        </span>
                      )}

                      {currentEvent.requiresRegistration && (
                        <span
                          className="font-medium text-[11px] px-2.5 py-1 rounded-xl"
                          style={{ backgroundColor: "rgba(139, 92, 246, 0.2)", color: "#8B5CF6" }}
                        >
                          Registration Required
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h2 className="font-bold text-3xl leading-tight">{currentEvent.title}</h2>

                    {/* Description */}
                    <p className="text-[15px] leading-relaxed" style={{ color: "rgba(255,255,255,0.9)" }}>
                      {currentEvent.description || "No description available."}
                    </p>

                    {/* Event Meta Info */}
                    <div className="space-y-3 pt-2">
                      <div className="flex gap-3 items-center">
                        <Calendar className="w-5 h-5" style={{ color: "rgba(255,255,255,0.8)" }} strokeWidth={2} />
                        <span className="text-[15px]">
                          {currentEvent.date} at {currentEvent.time}
                        </span>
                      </div>

                      <div className="flex gap-3 items-center">
                        <MapPin className="w-5 h-5" style={{ color: "rgba(255,255,255,0.8)" }} strokeWidth={2} />
                        <span className="text-[15px]">{currentEvent.location}</span>
                      </div>

                      <div className="flex gap-2 items-center pt-2">
                        <span
                          className="backdrop-blur-md font-bold text-[11px] text-white px-4 py-1.5 rounded-full"
                          style={{ backgroundColor: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)" }}
                        >
                          {currentEvent.category}
                        </span>
                        {currentEvent.isLive && (
                          <span
                            className="text-white font-bold text-[11px] px-3 py-1.5 rounded-full flex items-center gap-1.5"
                            style={{ backgroundColor: "#EF4444" }}
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            LIVE
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Additional Info Section */}
                <div className="grid grid-cols-3 gap-6 pt-4">
                  <div className="space-y-2">
                    <h3 className="font-bold text-sm uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.6)" }}>
                      Price
                    </h3>
                    <p className="font-bold text-xl text-white">
                      {currentEvent.price === 0 ? "Free" : `$${currentEvent.price}`}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <h3 className="font-bold text-sm uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.6)" }}>
                      Registration
                    </h3>
                    <p className="font-bold text-xl text-white">
                      {currentEvent.requiresRegistration ? "Required" : "Not Required"}
                    </p>
                  </div>

                  {currentEvent.food && currentEvent.food.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="font-bold text-sm uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.6)" }}>
                        Food Provided
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {currentEvent.food.map((item) => (
                          <span
                            key={item}
                            className="backdrop-blur-md text-xs text-white px-3 py-1.5 rounded-full"
                            style={{ backgroundColor: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)" }}
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Similar Events Section */}
            {similarEvents.length > 0 && (
              <div className="px-6 pb-8 pt-16 w-full">
                <h3 className="font-bold text-xl mb-6 text-gray-900 dark:text-gray-100">Similar Events</h3>
                <div className="grid grid-cols-4 gap-4">
                  {similarEvents.map((similarEvent) => (
                    <EventCard key={similarEvent.id} event={similarEvent} inModal onEventClick={handleEventChange} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
